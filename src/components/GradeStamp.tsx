/**
 * The circular "GRADE / AA / STITCH" stamp — the brand mascot mark. Doubles as
 * the app icon/avatar. Drawn as flat Stamp-Red ink (a double ring + pressed
 * type), optionally rotated like a hand stamp.
 */
const RED = "#B23A2E";

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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      role="img"
      aria-label={`${top} ${big} ${bottom}`}
      className={className}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <circle cx="40" cy="40" r="38" stroke={RED} strokeWidth="2.5" />
      <circle cx="40" cy="40" r="30" stroke={RED} strokeWidth="1" />
      <text
        x="40"
        y="31"
        textAnchor="middle"
        fill={RED}
        fontFamily="Oswald, sans-serif"
        fontSize="10"
        letterSpacing="1.2"
      >
        {top.toUpperCase()}
      </text>
      <text
        x="40"
        y="52"
        textAnchor="middle"
        fill={RED}
        fontFamily="Anton, Impact, sans-serif"
        fontSize="26"
        letterSpacing="1"
      >
        {big.toUpperCase()}
      </text>
      <text
        x="40"
        y="64"
        textAnchor="middle"
        fill={RED}
        fontFamily="Oswald, sans-serif"
        fontSize="8"
        letterSpacing="0.8"
      >
        {bottom.toUpperCase()}
      </text>
    </svg>
  );
}
