import React, { useEffect, useRef, useState } from 'react';
import { BrainCircuit, Check } from 'lucide-react';
import { ThinkingLevel } from '../types';

interface ThinkingLevelPickerProps {
  value: ThinkingLevel;
  onChange: (value: ThinkingLevel) => void;
  disabled?: boolean;
}

const options: Array<{
  value: ThinkingLevel;
  label: string;
  description: string;
}> = [
  { value: 'low', label: '低', description: '响应更快，适合简单优化' },
  { value: 'medium', label: '中', description: '速度与质量均衡' },
  { value: 'high', label: '高', description: '复杂意图与细节优先' },
];

const levelLabels: Record<ThinkingLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const ThinkingLevelPicker: React.FC<ThinkingLevelPickerProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="思考强度"
        className={`flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
          isOpen
            ? 'bg-amber-500/10 text-amber-300'
            : 'text-slate-400 hover:bg-slate-800 hover:text-amber-300'
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <BrainCircuit size={17} aria-hidden="true" />
        <span>思考·{levelLabels[value]}</span>
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="思考强度"
          className="absolute bottom-full left-0 z-50 mb-3 w-56 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl shadow-black/40"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-amber-500/10 text-amber-200'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-current/20 text-sm font-bold">
                  {option.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{option.label}强度</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {option.description}
                  </span>
                </span>
                {isSelected && <Check size={14} className="text-amber-300" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThinkingLevelPicker;
