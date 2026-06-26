import Index from "./pages/Index";
import Menu from "./pages/Menu";
import NotFound from "./pages/NotFound";
import HudLab from "./pages/HudLab";
import Editor from "./pages/Editor";

export const routers = [
    {
      path: "/",
      name: 'home',
      element: <Menu />,
    },
    {
      path: "/play",
      name: 'play',
      element: <Index />,
    },
    /* Secret HUD design lab (dev-only, unlinked) — screenshot target for design. */
    {
      path: "/hudlab",
      name: 'hudlab',
      element: <HudLab />,
    },
    /* Secret password-gated map editor (unlinked) — place/delete/save decor. */
    {
      path: "/editor",
      name: 'editor',
      element: <Editor />,
    },
    /* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */
    {
      path: "*",
      name: '404',
      element: <NotFound />,
    },
];

declare global {
  interface Window {
    __routers__: typeof routers;
  }
}

window.__routers__ = routers;