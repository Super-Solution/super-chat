/** The Super Chat mark: one speech bubble cut into three layers on a 28 degree shear. */
export const MARK_VIEWBOX = "2 -58 104 174";
export const MARK_LAYERS = {
  top: "M21 0H87Q100 0 100 13V23Q100 26 97 26H11Q8 26 8 23V13Q8 0 21 0Z",
  middle: "M11 33H97Q100 33 100 36V56Q100 59 97 59H11Q8 59 8 56V36Q8 33 11 33Z",
  bottom: "M11 66H97Q100 66 100 69V79Q100 92 87 92H44L8 116V69Q8 66 11 66Z",
};

/** `play` lands the layers in turn order once, the brand's MotionTurn moment. */
export function Mark({ size = 32, play = false }: { size?: number; play?: boolean }) {
  return (
    <svg className={`schat-mark${play ? " schat-turn-play" : ""}`} viewBox={MARK_VIEWBOX} height={size} aria-hidden="true">
      <g transform="skewY(-28)">
        <path className="schat-mark__layer schat-turn-top" d={MARK_LAYERS.top} />
        <path className="schat-mark__middle schat-turn-middle" d={MARK_LAYERS.middle} />
        <path className="schat-mark__layer schat-turn-bottom" d={MARK_LAYERS.bottom} />
      </g>
    </svg>
  );
}
