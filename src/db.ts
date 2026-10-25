import type { ImageRecord, DownloadJob, Collection } from "./shared";
let connection: Promise<IDBDatabase>;
/** DOMException is an Error at runtime but not in the IDB typings; wrapping
 *  keeps Promise rejection reasons uniformly Error instances. */
const reason = (e: unknown) =>
  e instanceof Error ? e : Error(String(e));
function db() {
  return (connection ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("zephyer", 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("records"))
        d.createObjectStore("records", { keyPath: "id" }).createIndex(
          "tabId",
          "tabId",
        );
      if (!d.objectStoreNames.contains("jobs"))
        d.createObjectStore("jobs", { keyPath: "id" });
      if (!d.objectStoreNames.contains("collections"))
        d.createObjectStore("collections", { keyPath: "id" });
      const records = r.transaction!.objectStore("records");
      if (!records.indexNames.contains("collectionId"))
        records.createIndex("collectionId", "collectionId");
      if (!records.indexNames.contains("tabPage"))
        records.createIndex("tabPage", ["tabId", "id"]);
      if (!records.indexNames.contains("collectionPage"))
        records.createIndex("collectionPage", ["collectionId", "id"]);
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        connection = undefined!;
      };
      resolve(r.result);
    };
    r.onerror = () => {
      connection = undefined!;
      reject(reason(r.error));
    };
  }));
}
export async function all<T>(store: string): Promise<T[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => { resolve(r.result); };
    r.onerror = () => { reject(reason(r.error)); };
  });
}
export async function put(store: string, values: unknown[]) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction(
      store === "records" ? ["records", "collections"] : [store],
      "readwrite",
    );
    const groups = new Map<string, ImageRecord[]>();
    for (const v of values) {
      const record = v as ImageRecord;
      if (store === "records" && record.collectionId) {
        const group = groups.get(record.collectionId) || [];
        group.push(record);
        groups.set(record.collectionId, group);
      } else tx.objectStore(store).put(v);
    }
    for (const [id, records] of groups) {
      const request = tx.objectStore("collections").get(id);
      request.onsuccess = () => {
        const collection = request.result as Collection | undefined;
        if (!collection) {
          tx.abort();
          return;
        }
        collection.revision++;
        let offset = 0;
        const writeBatch = () => {
          for (const record of records.slice(offset, offset + 200)) {
            record.discoveredOrder ??= collection.nextOrder++;
            record.collectionRevision = collection.revision;
            tx.objectStore("records").put(record);
          }
          offset += 200;
          if (offset < records.length) {
            // Keep the transaction atomic while yielding between bounded IDB callbacks.
            tx.objectStore("collections").get(id).onsuccess = writeBatch;
          } else tx.objectStore("collections").put(collection);
        };
        writeBatch();
      };
    }
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(reason(tx.error)); };
    tx.onabort = () => { reject(reason(tx.error || new Error("Database transaction aborted"))); };
  });
}
export async function removeTab(tabId: number) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("records", "readwrite");
    const os = tx.objectStore("records");
    const r = os.index("tabId").openCursor(IDBKeyRange.only(tabId));
    r.onsuccess = () => {
      if (r.result) {
        if (!r.result.value.detached) r.result.delete();
        r.result.continue();
      }
    };
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(reason(tx.error)); };
    tx.onabort = () => { reject(reason(tx.error || new Error("Database transaction aborted"))); };
  });
}
export async function getRecords(tabId: number): Promise<ImageRecord[]> {
  return (await pagedRecords("tabPage", tabId)).filter((r) => !r.detached);
}
export const getJobs = () => all<DownloadJob>("jobs");

export async function getRecordIds(tabId: number): Promise<string[]> {
  return (await getRecords(tabId)).map((r) => r.id);
}

export async function getRecordsByIds(ids: string[]): Promise<ImageRecord[]> {
  const values: ImageRecord[] = [];
  for (let offset = 0; offset < ids.length; offset += 200)
    values.push(...(await readRecordBatch(ids.slice(offset, offset + 200))));
  return values;
}
async function readRecordBatch(ids: string[]): Promise<ImageRecord[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("records"),
      store = tx.objectStore("records");
    const values: ImageRecord[] = [];
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) values.push(request.result);
      };
    }
    tx.oncomplete = () => { resolve(values); };
    tx.onerror = () => { reject(reason(tx.error)); };
    tx.onabort = () => { reject(reason(tx.error || new Error("Database transaction aborted"))); };
  });
}

export async function getCollection(
  id: string,
): Promise<Collection | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction("collections").objectStore("collections").get(id);
    r.onsuccess = () => { resolve(r.result); };
    r.onerror = () => { reject(reason(r.error)); };
  });
}
export async function collectionRecords(id: string): Promise<ImageRecord[]> {
  return pagedRecords("collectionPage", id);
}
async function pagedRecords(
  index: string,
  key: IDBValidKey,
): Promise<ImageRecord[]> {
  const d = await db(),
    values: ImageRecord[] = [];
  let after = "";
  while (true) {
    const rows = await new Promise<ImageRecord[]>((resolve, reject) => {
      const range = IDBKeyRange.bound([key, after], [key, []], !!after);
      const r = d
        .transaction("records")
        .objectStore("records")
        .index(index)
        .getAll(range, 200);
      r.onsuccess = () => { resolve(r.result); };
      r.onerror = () => { reject(reason(r.error)); };
    });
    values.push(...rows);
    if (rows.length < 200) return values;
    const last = rows[rows.length - 1];
    if (!last) return values;
    after = last.id;
  }
}
export async function deleteCollection(id: string) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction(["records", "collections"], "readwrite");
    tx.objectStore("collections").delete(id);
    const r = tx.objectStore("records").index("collectionId").openCursor(id);
    r.onsuccess = () => {
      if (r.result) {
        r.result.delete();
        r.result.continue();
      }
    };
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(reason(tx.error)); };
    tx.onabort = () => { reject(reason(tx.error || new Error("Database transaction aborted"))); };
  });
}

export async function patchCollection(
  id: string,
  changes: Pick<Partial<Collection>, "state" | "scan" | "title">,
) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("collections", "readwrite"),
      store = tx.objectStore("collections"),
      r = store.get(id);
    r.onsuccess = () => {
      if (r.result) store.put({ ...r.result, ...changes });
    };
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(reason(tx.error)); };
    tx.onabort = () => { reject(reason(tx.error || new Error("Database transaction aborted"))); };
  });
}
export async function deleteRecords(ids: string[]) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("records", "readwrite");
    for (const id of ids) tx.objectStore("records").delete(id);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(reason(tx.error)); };
    tx.onabort = () => { reject(reason(tx.error || new Error("Database transaction aborted"))); };
  });
}
