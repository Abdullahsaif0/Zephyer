// Shared optical treatment. No backdrop filter is placed on the viewport host
// or repeated gallery cards: only the small pieces of interface need compositing.
export const materialCSS = `
:root,:host{
  --z-radius:22px;--z-duration:200ms;--z-ease:cubic-bezier(.22,.8,.22,1);
  --z-edge:#ffffff38;--z-glint:#ffffff14;
  --z-shadow:0 18px 48px #00000030,0 3px 8px #00000018,inset 0 1px 0 var(--z-edge),inset 0 -1px 0 #00000012;
  --z-material:linear-gradient(145deg,var(--z-glint),transparent 48%),var(--z-glass);
  --z-control:color-mix(in srgb,var(--z-surface) 84%,transparent);
}
:root[data-theme="porcelain"],:host([data-theme="porcelain"]),
:root[data-theme="sand"],:host([data-theme="sand"]){--z-edge:#ffffffc9;--z-glint:#ffffff66}
.z-dock,.z-scan-hud,.tools,.z-dock-menu,.error,
header,.output,footer,.scan-card,.job,.roadmap,.preferences .settings-section{
  background:var(--z-surface);
  border-color:color-mix(in srgb,var(--z-line) 55%,transparent);
  box-shadow:var(--z-shadow);
}
@supports(backdrop-filter:blur(1px)){
  .z-dock,.z-scan-hud,.tools,.z-dock-menu,.error,
  header,.output,footer,.scan-card,.job,.roadmap,.preferences .settings-section{
    background:var(--z-material);backdrop-filter:blur(24px) saturate(1.45);
  }
}
.z-dock,.tools,.z-dock-menu{border-radius:22px}
.z-scan-hud{border-radius:22px;padding-top:16px}
.z-action,button,input,select,textarea{transition:background 140ms ease,border-color 140ms ease,box-shadow 140ms ease,transform 140ms var(--z-ease)}
.z-action:hover:not(:disabled),.tools button:hover:not(:disabled){background:var(--z-control);box-shadow:inset 0 1px 0 var(--z-edge)}
.z-action:active:not(:disabled){transform:scale(.94)}
.z-grip:active{transform:none}
.z-dock[data-dragging="true"] .z-action{transition:none}
.z-dock[data-dragging="true"] .z-grip{transform:none}
/* Small page-overlay copy must stay legible over a bright host page. */
.z-scan-copy span,.z-scan-copy small,.z-dock-status{color:var(--z-text)}
.z-grip{color:var(--z-text)}
.error{background:var(--z-surface)!important}
.z-selected-count{background:var(--z-control);border-radius:6px;padding:1px 3px}
.z-scan-track{top:5px;left:20px;right:20px;border-radius:4px}
.z-scan-hud:is([data-phase="scanning"],[data-phase="waiting"])::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(110deg,transparent 30%,var(--z-glint) 48%,transparent 65%);
  transform:translateX(-110%);animation:z-glass-pass 3200ms var(--z-ease) infinite;
}
.z-scan-hud[data-hidden-page="true"]::after{animation-play-state:paused}
.z-dock-menu{animation:z-material-enter 180ms var(--z-ease)}
.z-found-count[data-arrival="true"]{animation:z-count-arrival 220ms var(--z-ease)}
.box{border-radius:8px}.box.selected{background:color-mix(in srgb,var(--z-accent) 8%,transparent)}
.tools select,.tools button,.check,.z-inline-download{background:var(--z-control)}
@keyframes z-glass-pass{0%,20%{transform:translateX(-110%)}80%,100%{transform:translateX(110%)}}
@keyframes z-count-arrival{from{opacity:.55;translate:0 2px}to{opacity:1;translate:0 0}}
@keyframes z-material-enter{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){
  .z-dock,.z-scan-hud,.tools,.z-dock-menu,.error,header,.output,footer,.scan-card,.job,.roadmap,.preferences .settings-section{
    background:var(--z-surface)!important;backdrop-filter:none!important;border-color:var(--z-line);
  }
}
@media(forced-colors:active){
  :root,:host{--z-text:CanvasText;--z-muted:CanvasText;--z-accent:Highlight;--z-onAccent:HighlightText;--z-line:ButtonText;--z-bg:Canvas;--z-surface:Canvas;--z-control:Canvas;--z-hover:Canvas;--z-danger:LinkText}
  .z-dock,.z-scan-hud,.tools,.z-dock-menu,.error,header,.output,footer,.scan-card,.job,.roadmap,.preferences .settings-section{background:Canvas!important;backdrop-filter:none!important;box-shadow:none;border:1px solid CanvasText}
  .box.selected,.image-card.chosen{outline:2px solid Highlight}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
