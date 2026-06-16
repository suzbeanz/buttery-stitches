import { useId } from "react";

/**
 * The circular "GRADE / AA / STITCH" stamp — the brand mascot mark. Doubles as
 * the app icon/avatar. Drawn as warm Stamp-Red ink (a double ring + pressed
 * type), roughed up with a subtle distress filter so it reads like a real rubber
 * hand-stamp — slightly wobbly edges and broken ink — and rotated like one.
 */
const RED = "#BE4A30"; // warm terracotta stamp ink

export default function GradeStamp({
  size = 74,
  rotate = -7,
  top = "Grade",
  big = "AA",
  bottom = "Stitch",
  className = "",
}: {
  size?: number;
  rotate?: number;
  top?: string;
  big?: string;
  bottom?: string;
  className?: string;
}) {
  // Unique per instance so multiple stamps on a page don't share a filter id.
  const fid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      role="img"
      aria-label={`${top} ${big} ${bottom}`}
      className={`shrink-0 ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <defs>
        <filter id={`stamp-${fid}`} x="-15%" y="-15%" width="130%" height="130%">
          {/* wobble the edges like a hand-pressed stamp */}
          <feTurbulence type="fractalNoise" baseFrequency="0.045 0.06" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="disp" />
          {/* break the ink with a fine speckle so it's not a solid digital fill */}
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1 1.06" result="speck" />
          <feComposite in="disp" in2="speck" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#stamp-${fid})`}>
        <circle cx="40" cy="40" r="37.5" stroke={RED} strokeWidth="2.5" />
        <circle cx="40" cy="40" r="30" stroke={RED} strokeWidth="1.25" />
        <text
          x="40"
          y="26"
          textAnchor="middle"
          fill={RED}
          fontFamily="Oswald, sans-serif"
          fontWeight="600"
          fontSize="9.5"
          letterSpacing="1.4"
        >
          {top.toUpperCase()}
        </text>
        <text
          x="40"
          y="53"
          textAnchor="middle"
          fill={RED}
          fontFamily="Anton, Impact, sans-serif"
          fontSize="25"
          letterSpacing="0.5"
        >
          {big.toUpperCase()}
        </text>
        <text
          x="40"
          y="67"
          textAnchor="middle"
          fill={RED}
          fontFamily="Oswald, sans-serif"
          fontWeight="600"
          fontSize="8"
          letterSpacing="1"
        >
          {bottom.toUpperCase()}
        </text>
      </g>
    </svg>
  );
}
