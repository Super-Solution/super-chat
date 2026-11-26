// `@supersolutions/super-chat-ui/surfaces`: interfaces an agent builds (the surface renderer, its
// host and the card that places one in a thread).
export {
  SurfaceView,
  SurfaceHostProvider,
  useSurfaceCatalogue,
  type SurfaceViewProps,
  type SurfaceHostProviderProps,
  type SurfacePlacement,
  type SurfaceCustomRenderer,
  type SurfaceCustomRendererProps,
} from "./surfaces/SurfaceView.js";
export { AgentSurface, SurfaceCardView, type AgentSurfaceProps } from "./surfaces/AgentSurface.js";
