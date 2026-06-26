import { ENV_PROPS, type EnvProp } from "@/game/map/MapDefinition";
import { INK } from "@/components/hud/primitives";

/**
 * Left-sidebar prop palette for the map editor. Deliberately uses flat TEXT +
 * COLOR tiles (no 3D thumbnails) so it's cheap and unambiguous: trees green,
 * boxes brown, grass props light-green. The active tile gets a thick white ring.
 */

interface TileLook {
  label: string;
  bg: string;
  fg: string;
}

const LOOK: Record<EnvProp, TileLook> = {
  tree1: { label: "Tree 1", bg: "#3f9b46", fg: "#ffffff" },
  tree2: { label: "Tree 2", bg: "#2f7d3a", fg: "#ffffff" },
  box1: { label: "Box 1", bg: "#9c6b3f", fg: "#ffffff" },
  box2: { label: "Box 2", bg: "#7d5230", fg: "#ffffff" },
  grassflower1: { label: "Flower 1", bg: "#b6e3a0", fg: INK },
  grassflower2: { label: "Flower 2", bg: "#a6dd8d", fg: INK },
  grassmushroom: { label: "Mushroom", bg: "#c7e8b4", fg: INK },
};

interface PropPaletteProps {
  selected: EnvProp;
  onSelect: (asset: EnvProp) => void;
  /** Place mode highlights the active tile; delete mode dims the whole grid. */
  disabled: boolean;
}

export function PropPalette({ selected, onSelect, disabled }: PropPaletteProps) {
  return (
    <div
      className="grid grid-cols-2 gap-1.5"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      {ENV_PROPS.map((asset) => {
        const look = LOOK[asset];
        const active = !disabled && asset === selected;
        return (
          <button
            key={asset}
            type="button"
            onClick={() => onSelect(asset)}
            className="pointer-events-auto flex h-12 items-center justify-center rounded-md text-[12px] font-bold leading-none transition-transform active:scale-95"
            style={{
              background: look.bg,
              color: look.fg,
              border: `2px solid ${INK}`,
              boxShadow: active
                ? "0 0 0 3px #ffffff, 0 2px 0 rgba(0,0,0,0.4)"
                : "0 2px 0 rgba(0,0,0,0.4)",
            }}
          >
            {look.label}
          </button>
        );
      })}
    </div>
  );
}
