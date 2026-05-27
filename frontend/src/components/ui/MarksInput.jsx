import { Input } from "./Input";
import { decimalInput, integerInput } from "../../utils/inputSanitizers";

export function MarksInput({
  onChange,
  onKeyDown,
  onWheel,
  inputMode = "decimal",
  pattern = "[0-9]*[.]?[0-9]*",
  integer = false,
  maxDigits,
  decimalPlaces = 2,
  ...props
}) {
  const digitLimit = maxDigits ?? (integer ? 5 : 5);

  return (
    <Input
      {...props}
      type="text"
      inputMode={integer ? "numeric" : inputMode}
      pattern={integer ? "[0-9]*" : pattern}
      maxLength={integer ? digitLimit : digitLimit + decimalPlaces + 1}
      onChange={event => {
        const sanitized = integer
          ? integerInput(event.target.value, digitLimit)
          : decimalInput(event.target.value, digitLimit, decimalPlaces);
        if (event.target.value !== sanitized) {
          event.target.value = sanitized;
        }
        onChange?.(event);
      }}
      onWheel={event => {
        event.currentTarget.blur();
        onWheel?.(event);
      }}
      onKeyDown={event => {
        if (["e", "E", "+", "-"].includes(event.key) || (integer && event.key === ".")) {
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
