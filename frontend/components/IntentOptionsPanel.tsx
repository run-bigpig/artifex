import React from 'react';
import { ArrowUpRight, GitBranch, Loader2, X } from 'lucide-react';
import { IntentOption } from '../types';

interface IntentOptionsPanelProps {
  options: IntentOption[];
  isLoading: boolean;
  error: string;
  onSelect: (option: IntentOption) => void;
  onClose: () => void;
}

const IntentOptionsPanel: React.FC<IntentOptionsPanelProps> = ({
  options,
  isLoading,
  error,
  onSelect,
  onClose,
}) => {
  if (!isLoading && !error && options.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-3 overflow-hidden rounded-2xl border border-cyan-500/25 bg-slate-950/95 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
          <GitBranch size={15} aria-hidden="true" />
          <span>选择你真正想表达的意图</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          title="关闭意图列表"
          aria-label="关闭意图列表"
        >
          <X size={15} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 px-4 py-5 text-sm text-slate-400">
          <Loader2 size={18} className="animate-spin text-cyan-400" />
          正在分析当前文本与参考图中的可能意图…
        </div>
      )}

      {!isLoading && error && (
        <div className="px-4 py-4 text-sm text-red-300">{error}</div>
      )}

      {!isLoading && options.length > 0 && (
        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {options.map((option, index) => (
            <button
              key={`${option.title}-${index}`}
              type="button"
              onClick={() => onSelect(option)}
              className="group flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-cyan-500/20 hover:bg-cyan-500/8"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-xs font-bold text-cyan-300">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-100">{option.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{option.description}</span>
                <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-cyan-100/75">{option.prompt}</span>
              </span>
              <ArrowUpRight size={15} className="mt-1 shrink-0 text-slate-600 transition-colors group-hover:text-cyan-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default IntentOptionsPanel;
