import { Input } from "./Input";

export function MarksInput({ onKeyDown, onWheel, inputMode = "decimal", pattern = "[0-9]*[.]?[0-9]*", ...props }) {
  return (
    <Input
      {...props}
      type="number"
      inputMode={inputMode}
      pattern={pattern}
      onWheel={event => {
        event.currentTarget.blur();
        onWheel?.(event);
      }}
      onKeyDown={event => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
