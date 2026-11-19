export const THEME_KEY = "superchat:site-theme";

/** Runs before first paint on themed pages, so a saved choice never flashes the other theme. */
export const themeBootstrap = (paths: string[]) =>
  `try{var p=location.pathname.replace(/\\/$/,"")||"/";if(${JSON.stringify(paths)}.indexOf(p)>-1){var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
