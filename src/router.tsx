import Index from "./pages/Index";
import Menu from "./pages/Menu";
import NotFound from "./pages/NotFound";
import HudLab from "./pages/HudLab";

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