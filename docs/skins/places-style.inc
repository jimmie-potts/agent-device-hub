.places-nav{box-sizing:border-box;display:flex;align-items:center;flex-wrap:wrap;gap:.35rem .65rem;width:100vw;max-width:100%;padding:.55rem .85rem;border-block:1px solid var(--edge-other);background:transparent;color:var(--status-open);font:500 .8rem/1.4 system-ui,sans-serif;letter-spacing:normal;overflow-wrap:anywhere}
.places-nav *{box-sizing:border-box}
.places-nav__brand{font-weight:750;letter-spacing:.07em;color:var(--status-delivered);margin-right:.4rem}
.places-nav__current{font-weight:650;color:var(--status-delivered)}
.places-nav__links{display:flex;align-items:center;flex-wrap:wrap;gap:.2rem .65rem;min-width:0}
.places-nav a,.places-nav__current{display:inline-flex;align-items:center;gap:.25rem;padding:.15rem .2rem;white-space:normal}
.places-nav a{color:var(--status-open);text-decoration:underline;text-underline-offset:.2em}
.places-nav a:hover,.places-nav a:focus-visible{color:var(--status-delivered)}
.places-nav a:focus-visible{outline:2px solid var(--status-delivered);outline-offset:2px}
.places-nav__tag{font-size:.67rem;text-transform:uppercase;letter-spacing:.05em;color:var(--status-active)}
@media print{.places-nav{display:none}}
