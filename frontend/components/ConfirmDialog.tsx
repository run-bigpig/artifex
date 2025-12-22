/**
 * 确认对话框组件
 * 替代原生的 window.confirm 和 alert，提供更好的用户体验
 */

import React from 'react';
import { AlertTriangle, X, CheckCircle2, AlertCircle } from 'lucide-react';

export type ConfirmDialogType = 'confirm' | 'alert' | 'warning';

interface ConfirmDialogProps {
  isOpen: boolean;
  type?: ConfirmDialogType;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButtonClassName?: string;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  type = 'confirm',
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel,
  confirmButtonClassName = ''
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'warning':
        return <AlertTriangle className="text-yellow-500" size={24} />;
      case 'alert':
        return <AlertCircle className="text-red-500" size={24} />;
      default:
        return <AlertTriangle className="text-blue-500" size={24} />;
    }
  };

  const getConfirmButtonColor = () => {
    switch (type) {
      case 'warning':
        return 'bg-yellow-600 hover:bg-yellow-700';
      case 'alert':
        return 'bg-red-600 hover:bg-red-700';
      default:
        return 'bg-blue-600 hover:bg-blue-700';
    }
  };

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
        onClick={onCancel}
      >
        {/* 对话框 */}
        <div
          className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800">
            <div className="flex-shrink-0">
              {getIcon()}
            </div>
            <h3 className="text-lg font-semibold text-slate-200 flex-1">
              {title}
            </h3>
            <button
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1 hover:bg-slate-800 rounded"
              aria-label="关闭"
            >
              <X size={20} />
            </button>
          </div>

          {/* 内容 */}
          <div className="px-6 py-4">
            <p className="text-slate-300 leading-relaxed">
              {message}
            </p>
          </div>

          {/* 底部按钮 */}
          <div className="px-6 py-4 bg-slate-800/50 flex gap-3 justify-end">
            {type !== 'alert' && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-slate-300 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-white rounded-lg transition-colors font-medium ${
                confirmButtonClassName || getConfirmButtonColor()
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ConfirmDialog;

