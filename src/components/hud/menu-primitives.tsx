import { type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { HEX, HUD, INK, IconWell } from "./primitives";

/**
 * Menu-screen primitives — the "Cocoa Cream" language (GLM 5.2). Same structural
 * DNA as the in-match HUD (thick ink borders, hard stepped shadows, accent rings,
 * hexagon icon wells, ribbon titles) but on a WARM CREAM surface, so menus read
 * as "menu mode" and pop forward over the blurred bright scene — while the dark
 * cocoa-glass HUD primitives are reserved for modals/dropdowns (in-game family).
 *
 * Reuses HUD primitives + utilities (.hud-num/.hud-label/.hud-text). Replaces the
 * old parchment cards + soft cozy-shadow + paper-grain.
 */

export const CREAM = "#F7EEDF";
export const INK_TEXT = "#3B291F";

/** Stacked hard shadow (toy-block bevel) — no blur. */
const stack = (n: number, soft = 0.22) =>
  `0 ${n}px 0 ${INK}, 0 ${n + 4}px 0 rgba(0,0,0,${soft})`;

/* ─────────────────────────── BackButton ─────────────────────────── */

export const BackButton = ({
  onClick,
  accent = HUD.honey,
}: {
  onClick: () => void;
  accent?: string;
}) => (
  <button
    type="button"
    aria-label="Voltar"
    onClick={onClick}
    className="grid shrink-0 place-items-center transition-transform hover:-translate-y-0.5 active:translate-y-[2px]"
    style={{ width: 40, height: 40, clipPath: HEX, background: accent, outline: `3px solid ${INK}` }}
  >
    <ArrowLeft style={{ width: 18, height: 18, color: "#fff" }} strokeWidth={3} />
  </button>
);

/* ─────────────────────────── ScreenShell ─────────────────────────── */

interface ScreenShellProps {
  title: string;
  accent?: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width in px (default 460). */
  maxWidth?: number;
  className?: string;
  contentClassName?: string;
}

/** The common cream panel frame every menu screen lives in. */
export const ScreenShell = ({
  title,
  accent = HUD.honey,
  onBack,
  children,
  footer,
  maxWidth = 460,
  className,
  contentClassName,
}: ScreenShellProps) => (
  <div
    className={cn("relative w-full animate-rise", className)}
    style={{
      maxWidth,
      background: CREAM,
      border: `3px solid ${INK}`,
      borderRadius: 16,
      boxShadow: `0 0 0 1.5px ${accent}, 0 6px 0 rgba(0,0,0,0.42), 0 12px 26px rgba(0,0,0,0.18)`,
    }}
  >
    {/* Title ribbon + back */}
    <div className="flex items-center gap-2.5 px-4 pt-4">
      {onBack && <BackButton onClick={onBack} accent={accent} />}
      <div
        className="flex flex-1 items-center"
        style={{
          background: `${accent}f0`,
          border: `2px solid ${INK}`,
          borderRadius: 999,
          padding: "6px 16px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.30), 0 3px 0 rgba(0,0,0,0.40)",
        }}
      >
        <span
          className="font-display text-[18px] font-bold leading-none text-white"
          style={{ textShadow: `1px 1px 0 ${INK}` }}
        >
          {title}
        </span>
      </div>
    </div>

    {/* Content on a subtle inset cream stage */}
    <div className="p-4">
      <div
        className={cn("rounded-[12px] p-4", contentClassName)}
        style={{ background: "rgba(59,41,31,0.05)", border: `1px solid ${INK}22` }}
      >
        {children}
      </div>
    </div>

    {footer && <div className="px-4 pb-4">{footer}</div>}
  </div>
);

/* ─────────────────────────── MenuButton ─────────────────────────── */

interface MenuButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  accent?: string;
}

/** Primary vertical menu action (Single player, Multiplayer, …). */
export const MenuButton = ({
  label,
  icon,
  onClick,
  primary = false,
  disabled = false,
  accent = HUD.honey,
}: MenuButtonProps) => {
  const fill = primary ? HUD.rose : CREAM;
  const labelColor = primary ? "#fff" : INK_TEXT;
  const ring = primary ? HUD.honey : accent;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 text-left transition-transform hover:-translate-y-0.5 active:translate-y-[2px] disabled:translate-y-0 disabled:opacity-50"
      style={{
        background: disabled ? HUD.muted : fill,
        border: `3px solid ${INK}`,
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: disabled ? "none" : `0 0 0 1.5px ${ring}, ${stack(5, 0.3)}`,
      }}
    >
      <IconWell icon={icon} accent={primary ? HUD.honey : accent} size={38} shape="hex" />
      <span
        className="flex-1 font-sans text-[16px] font-bold"
        style={{ color: labelColor, textShadow: primary ? `1px 1px 0 ${INK}` : "none" }}
      >
        {label}
      </span>
      <ChevronRight
        className="transition-transform group-hover:translate-x-0.5"
        style={{ width: 20, height: 20, color: primary ? "#fff" : INK }}
        strokeWidth={3}
      />
    </button>
  );
};

/* ─────────────────────────── PlayButton ─────────────────────────── */

interface PlayButtonProps {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
}

/** Big primary CTA (JOGAR / Vamos lá!). */
export const PlayButton = ({
  label,
  onClick,
  icon: Icon,
  disabled = false,
  className,
}: PlayButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "flex w-full items-center justify-center gap-2.5 transition-transform hover:-translate-y-0.5 active:translate-y-[3px] disabled:translate-y-0 disabled:opacity-50",
      className,
    )}
    style={{
      background: disabled ? HUD.muted : HUD.rose,
      border: `3px solid ${INK}`,
      borderRadius: 12,
      padding: "14px 22px",
      boxShadow: disabled ? "none" : `0 0 0 1.5px ${HUD.honey}, ${stack(6, 0.25)}`,
    }}
  >
    {Icon && <Icon style={{ width: 22, height: 22, color: "#fff" }} strokeWidth={3} />}
    <span
      className="hud-num leading-none"
      style={{ fontSize: 20, WebkitTextStrokeWidth: 2 }}
    >
      {label}
    </span>
  </button>
);

/* ─────────────────────────── TextField ─────────────────────────── */

interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  icon?: LucideIcon;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}

export const TextField = ({
  value,
  onChange,
  placeholder,
  maxLength,
  icon: Icon,
  onKeyDown,
  className,
}: TextFieldProps) => (
  <div
    className={cn("flex items-center gap-2", className)}
    style={{
      background: CREAM,
      border: `2px solid ${INK}`,
      borderRadius: 10,
      padding: "8px 12px",
      boxShadow: `0 3px 0 ${INK}`,
    }}
  >
    {Icon && <IconWell icon={Icon} accent={HUD.honey} size={26} />}
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      maxLength={maxLength}
      className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-[#9B7B63]"
      style={{ color: INK_TEXT }}
    />
    {maxLength != null && (
      <span className="text-[11px] font-bold tabular-nums" style={{ color: "#9B7B63" }}>
        {value.length}/{maxLength}
      </span>
    )}
  </div>
);

/* ─────────────────────────── ToggleRow ─────────────────────────── */

interface ToggleRowProps {
  on: boolean;
  onToggle: () => void;
  title: string;
  desc?: string;
  icon: LucideIcon;
  accent?: string;
}

export const ToggleRow = ({
  on,
  onToggle,
  title,
  desc,
  icon,
  accent = HUD.rose,
}: ToggleRowProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={onToggle}
    className="flex w-full items-center gap-3 text-left"
    style={{
      background: CREAM,
      border: `2px solid ${INK}`,
      borderRadius: 10,
      padding: "10px 12px",
      boxShadow: `0 3px 0 ${INK}`,
    }}
  >
    <IconWell icon={icon} accent={on ? accent : HUD.muted} size={32} />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[14px] font-bold" style={{ color: INK_TEXT }}>{title}</span>
      {desc && <span className="text-[11px] leading-snug" style={{ color: "#9B7B63" }}>{desc}</span>}
    </span>
    {/* Chunky track */}
    <span
      className="relative shrink-0"
      style={{
        width: 52,
        height: 28,
        borderRadius: 14,
        border: `2px solid ${INK}`,
        background: on ? accent : CREAM,
        transition: "background 120ms steps(2)",
      }}
    >
      <span
        className="absolute top-1/2"
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: `2px solid ${INK}`,
          background: on ? "#fff" : HUD.terracotta,
          transform: `translateY(-50%) translateX(${on ? 26 : 2}px)`,
          transition: "transform 120ms steps(2)",
          boxShadow: `0 2px 0 ${INK}`,
        }}
      />
    </span>
  </button>
);

/* ─────────────────────────── SelectField ─────────────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  icon?: LucideIcon;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Chunky game-style native select (cream pill + ink border + hex chevron). */
export const SelectField = ({
  value,
  onChange,
  options,
  icon: Icon,
  disabled = false,
  ariaLabel,
}: SelectFieldProps) => (
  <div
    className="flex items-center gap-2"
    style={{
      background: CREAM,
      border: `2px solid ${INK}`,
      borderRadius: 8,
      padding: "6px 6px 6px 10px",
      boxShadow: `0 3px 0 ${INK}`,
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {Icon && <IconWell icon={Icon} accent={HUD.honey} size={26} />}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-[13px] font-semibold outline-none disabled:cursor-not-allowed"
      style={{ color: INK_TEXT }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

/* ─────────────────────────── KeyHint ─────────────────────────── */

export const KeyHint = ({
  children,
  wide = false,
  accent,
}: {
  children: ReactNode;
  wide?: boolean;
  accent?: string;
}) => (
  <span
    className="inline-grid place-items-center font-bold leading-none"
    style={{
      minWidth: wide ? 56 : 38,
      height: 38,
      padding: wide ? "0 10px" : 0,
      background: accent ?? CREAM,
      color: accent ? "#fff" : INK_TEXT,
      border: `2px solid ${INK}`,
      borderRadius: 8,
      fontSize: 13,
      boxShadow: `0 3px 0 ${INK}`,
      textShadow: accent ? `1px 1px 0 ${INK}` : "none",
    }}
  >
    {children}
  </span>
);

/* ─────────────────────────── CharacterCard ─────────────────────────── */

interface CharacterCardProps {
  selected?: boolean;
  locked?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  name?: string;
  size?: number;
  children?: ReactNode; // voxel preview / swatch
  style?: CSSProperties;
}

export const CharacterCard = ({
  selected = false,
  locked = false,
  onClick,
  onHover,
  name,
  size = 88,
  children,
  style,
}: CharacterCardProps) => (
  <button
    type="button"
    onClick={onClick}
    onMouseEnter={onHover}
    disabled={locked}
    className="group relative grid place-items-center transition-transform hover:-translate-y-0.5 disabled:translate-y-0"
    style={{
      width: size,
      height: size,
      background: CREAM,
      border: `${selected ? 3 : 2}px solid ${selected ? HUD.rose : INK}`,
      borderRadius: 10,
      boxShadow: selected
        ? `0 0 0 1.5px ${HUD.honey}, 0 4px 0 ${INK}`
        : `0 3px 0 rgba(0,0,0,0.35)`,
      opacity: locked ? 0.45 : 1,
      ...style,
    }}
  >
    {children}
    {name && (
      <span
        className="hud-label absolute inset-x-0 bottom-1 text-center text-[9px]"
        style={{ color: INK_TEXT, textShadow: "none" }}
      >
        {name}
      </span>
    )}
  </button>
);
