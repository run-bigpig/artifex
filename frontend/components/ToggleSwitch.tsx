import React from "react";
import "./ToggleSwitch.css";

export default function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  description,
  disabled = false,
  compact = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  ariaLabel?: string;
  description?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`toggle-switch${compact ? " toggle-switch--compact" : ""}`}
    >
      <span className="toggle-switch__copy">
        <span className="toggle-switch__label">{label}</span>
        {description && (
          <span className="toggle-switch__description">{description}</span>
        )}
      </span>
      <span className="toggle-switch__track" aria-hidden="true">
        <span className="toggle-switch__thumb" />
      </span>
    </button>
  );
}
