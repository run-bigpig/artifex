import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChatMessage, CanvasImage, Attachment, ModelSettings, AspectRatio, ImageSize, MessageType } from '../types';
import { Send, Bot, Sparkles, X, Paperclip, Edit2, Wand2, Loader2, Monitor, Square, RectangleHorizontal, RectangleVertical, Image, Trash2, Square as StopIcon } from 'lucide-react';
import { 
  enhancePrompt, 
  enhancePromptCancellable,
  CancellableRequest,
  generateImageCancellable,
  editMultiImagesCancellable
} from '../services/aiService';
import { loadChatHistory, saveChatHistory, clearChatHistory, flushChatHistory } from '../services/historyService';
import { storeImage } from '../services/imageService';
import ConfirmDialog from './ConfirmDialog';
import { ensureDataUrl, isDataUrl, isImageRef, normalizeImageSrc, toImageRef } from '../utils/imageSource';

interface SidebarProps {
  // Application Actions
  onGenerate: (prompt: string) => Promise<string>;
  // onEdit takes image data URLs for AI requests
  onEdit: (prompt: string, base64Sources: string[]) => Promise<string>;
  onAddToCanvas: (imageSrc: string) => void;
  
  // State from App
  isProcessing: boolean;
  
  // Input Control
  inputValue: string;
  setInputValue: (val: string) => void;
  
  // Attachment
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  
  // Data (needed to resolve canvas attachments)
  images: CanvasImage[];
  
  // Settings
  modelSettings: ModelSettings;
  setModelSettings: (settings: ModelSettings) => void;

  // Loading callback
  onChatHistoryLoaded?: () => void;
  
  // 用于获取当前消息的 ref（用于关闭时保存）
  messagesRef?: React.MutableRefObject<ChatMessage[] | null>;
}

const Sidebar: React.FC<SidebarProps> = ({
  onGenerate,
  onEdit,
  onAddToCanvas,
  isProcessing,
  inputValue,
  setInputValue,
  attachments,
  setAttachments,
  images,
  modelSettings,
  setModelSettings,
  onChatHistoryLoaded,
  messagesRef
}) => {
  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showResPicker, setShowResPicker] = useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  
  // 请求状态管理
  const [currentRequest, setCurrentRequest] = useState<CancellableRequest<string> | null>(null);
  const [currentEnhanceRequest, setCurrentEnhanceRequest] = useState<CancellableRequest<string> | null>(null);
  const [isRequestActive, setIsRequestActive] = useState(false);
  const currentLoadingIdRef = useRef<string | null>(null); // 当前加载消息的 ID
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resPickerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const prevAttachmentsLengthRef = useRef<number>(0);
  const prevMessagesRef = useRef<ChatMessage[] | null>(null);
  const prevMessagesCountRef = useRef<number>(0); // 跟踪上一次的消息数量，用于检测新消息
  
  // ✅ 添加加载标志，防止重复加载
  const isLoadingHistoryRef = useRef(false);
  const hasLoadedHistoryRef = useRef(false);
  
  // 防抖处理：防止快速多次点击
  const submitDebounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'confirm' | 'alert' | 'warning';
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // ✅ 修复：使用 useRef 存储回调，避免依赖变化导致重复加载
  // 使用 ref 存储回调函数，确保只在组件挂载时执行一次
  const onChatHistoryLoadedRef = useRef(onChatHistoryLoaded);
  useEffect(() => {
    onChatHistoryLoadedRef.current = onChatHistoryLoaded;
  }, [onChatHistoryLoaded]);

  const sanitizeInterruptedMessages = (items: ChatMessage[]): { sanitized: ChatMessage[]; hasInterrupted: boolean } => {
    let hasInterrupted = false;
    const sanitized: ChatMessage[] = items.map((msg) => {
      if (msg.id.startsWith('loading-') && msg.type === 'system') {
        hasInterrupted = true;
        return {
          ...msg,
          type: 'error' as MessageType,
          text: '生成中断，请重试'
        };
      }
      return msg;
    });
    return { sanitized, hasInterrupted };
  };

  // ✅ 应用启动时加载聊天历史记录（只执行一次）
  useEffect(() => {
    // 防止重复加载
    if (hasLoadedHistoryRef.current || isLoadingHistoryRef.current) {
      return;
    }
    
    isLoadingHistoryRef.current = true;
    hasLoadedHistoryRef.current = true;
    
    const loadHistory = async () => {
      try {
        const savedMessages = await loadChatHistory();
        let finalMessages: ChatMessage[];
        if (savedMessages.length > 0) {
          const { sanitized, hasInterrupted } = sanitizeInterruptedMessages(savedMessages);
          finalMessages = sanitized;
          setMessages(sanitized);
          if (hasInterrupted) {
            flushChatHistory(sanitized);
          }
        } else {
          // 如果没有历史记录，显示欢迎消息
          finalMessages = [
            { 
              id: '1', 
              role: 'model', 
              type: 'text',
              text: '欢迎使用ArtifexBot。输入提示词即可生成和编辑图片。', 
              timestamp: Date.now() 
            }
          ];
          setMessages(finalMessages);
        }
        // 更新消息快照（深拷贝）
        prevMessagesRef.current = finalMessages.map(msg => ({
          ...msg,
          images: msg.images ? [...msg.images] : undefined
        }));
        // 初始化消息数量记录
        prevMessagesCountRef.current = finalMessages.length;
      } catch (error) {
        console.error('Failed to load chat history:', error);
        // 加载失败时显示欢迎消息
        const welcomeMessage: ChatMessage[] = [
          { 
            id: '1', 
            role: 'model', 
            type: 'text',
            text: '欢迎使用ArtifexBot。输入提示词即可生成和编辑图片。', 
            timestamp: Date.now() 
          }
        ];
        setMessages(welcomeMessage);
        // 初始化快照
        prevMessagesRef.current = welcomeMessage.map(msg => ({
          ...msg,
          images: msg.images ? [...msg.images] : undefined
        }));
        // 初始化消息数量记录
        prevMessagesCountRef.current = welcomeMessage.length;
      } finally {
        isInitialLoadRef.current = false;
        isLoadingHistoryRef.current = false;
        // 通知父组件聊天历史加载完成（使用 ref 确保调用最新的回调）
        setTimeout(() => {
          onChatHistoryLoadedRef.current?.();
        }, 0);
      }
    };
    loadHistory();
    // ✅ 修复：移除 onChatHistoryLoaded 依赖，只在组件挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖数组，确保只在组件挂载时执行一次

  // 自动保存聊天历史记录（仅在数据实际变化时触发）
  useEffect(() => {
    // 初始加载时不保存
    if (isInitialLoadRef.current) {
      return;
    }

    // 获取上一次的消息快照
    const prevMessages = prevMessagesRef.current;

    // 检查消息是否真正发生变化
    if (prevMessages) {
      // 比较消息数组长度
      if (prevMessages.length !== messages.length) {
        // 长度变化，数据已变化
      } else {
        // 长度相同，比较每条消息的内容
        const messagesChanged = messages.some((msg, index) => {
          const prevMsg = prevMessages[index];
          if (!prevMsg) return true;
          
          // 比较基本字段
          if (
            msg.id !== prevMsg.id ||
            msg.role !== prevMsg.role ||
            msg.type !== prevMsg.type ||
            msg.text !== prevMsg.text ||
            msg.timestamp !== prevMsg.timestamp
          ) {
            return true;
          }
          
          // 比较 images 数组（避免 JSON.stringify，直接比较数组）
          const msgImages = msg.images || [];
          const prevImages = prevMsg.images || [];
          if (msgImages.length !== prevImages.length) {
            return true;
          }
          // 比较每个图片的引用（如果引用相同，内容也相同）
          return msgImages.some((img, imgIndex) => img !== prevImages[imgIndex]);
        });

        // 如果消息内容没有变化，不保存
        if (!messagesChanged) {
          return;
        }
      }
    }

    // 数据发生变化，立即保存（使用事件系统，完全非阻塞）
    saveChatHistory(messages);

    // 更新消息快照（深拷贝）
    prevMessagesRef.current = messages.map(msg => ({
      ...msg,
      images: msg.images ? [...msg.images] : undefined
    }));
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = chatEndRef.current;
    if (!node) {
      return;
    }
    node.scrollIntoView({ behavior, block: 'end' });
  }, []);

  // Auto-scroll: 只在有新消息出现时自动滚动
  useEffect(() => {
    if (isAutoScrollPaused) {
      return;
    }
    // 检查是否有新消息（消息数量增加）
    const currentCount = messages.length;
    const prevCount = prevMessagesCountRef.current;
    
    // 只有当消息数量增加时才滚动（有新消息）
    if (currentCount > prevCount) {
      scrollToBottom('smooth');
    }
    
    // 更新消息数量记录
    prevMessagesCountRef.current = currentCount;
  }, [messages, isAutoScrollPaused, scrollToBottom]);

  // ✅ 应用关闭时保存聊天历史记录（后备方案，用于异常退出）
  // 使用传入的 messagesRef 或创建本地 ref
  const localMessagesRef = useRef<ChatMessage[]>(messages);
  const activeMessagesRef = messagesRef || localMessagesRef;
  
  useEffect(() => {
    localMessagesRef.current = messages;
    if (messagesRef) {
      messagesRef.current = messages;
    }
  }, [messages, messagesRef]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      // 立即保存聊天历史，取消待执行的防抖保存
      const currentMessages = activeMessagesRef.current;
      if (currentMessages) {
        flushChatHistory(currentMessages);
      }
    };

    // 监听页面卸载事件（应用关闭时）
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 组件卸载时也保存（作为后备方案）
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // 组件卸载时立即保存
      const currentMessages = activeMessagesRef.current;
      if (currentMessages) {
        flushChatHistory(currentMessages);
      }
    };
  }, [activeMessagesRef]); // 依赖 activeMessagesRef

  // Focus textarea when attached image changes (user clicked action)
  useEffect(() => {
    if (attachments.length > 0) {
      textareaRef.current?.focus();
    }
  }, [attachments.length]);

  // 当有参考图时，默认设置为保持原图（空字符串）
  // 当没有参考图时，如果 aspectRatio 或 imageSize 是空字符串，重置为默认值
  useEffect(() => {
    const prevLength = prevAttachmentsLengthRef.current;
    const currentLength = attachments.length;
    
    // 只在状态变化时自动设置（从无到有，或从有到无）
    if (prevLength === 0 && currentLength > 0) {
      // 从无参考图变为有参考图：自动设置为保持原图
      setModelSettings(prev => ({
        ...prev,
        aspectRatio: "",
        imageSize: ""
      }));
    } else if (prevLength > 0 && currentLength === 0) {
      // 从有参考图变为无参考图：重置为默认值
      setModelSettings(prev => ({
        ...prev,
        aspectRatio: '1:1',
        imageSize: '1K'
      }));
    }
    
    // 更新引用
    prevAttachmentsLengthRef.current = currentLength;
  }, [attachments.length]);
  
  // Close res picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (resPickerRef.current && !resPickerRef.current.contains(event.target as Node)) {
        setShowResPicker(false);
      }
    };
    if (showResPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showResPicker]);

  const addMessage = (role: 'user' | 'model', text: string, type: 'text' | 'system' | 'error' = 'text', messageImages?: string[]) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role,
      type,
      text,
      images: messageImages,
      timestamp: Date.now()
    }]);
  };

  // ✅ 性能优化：使用索引加速查找
  const imageIndex = useMemo(() => {
    // 只在 images 变化时重建索引
    const index = new Map<string, CanvasImage>();
    images.forEach(img => index.set(img.id, img));
    return index;
  }, [images]);

  const normalizeAttachmentSrc = (src: string): string => {
    if (isDataUrl(src)) {
      return src;
    }
    const ref = toImageRef(src);
    if (isImageRef(ref)) {
      return normalizeImageSrc(ref);
    }
    return src;
  };

  // Helper to resolve attachments to viewable objects
  const resolveAttachment = (att: Attachment): { id: string, src: string } | null => {
    if (att.type === 'local') {
      return { id: att.id, src: normalizeAttachmentSrc(att.content) };
    }
    if (att.type === 'url') {
      return { id: att.id, src: normalizeAttachmentSrc(att.content) };
    }

    // Canvas type - use index for O(1) lookup
    const img = imageIndex.get(att.content);
    if (img) return { id: att.id, src: normalizeAttachmentSrc(img.src) };
    return null;
  };

  const resolvedAttachments = attachments
    .map(resolveAttachment)
    .filter((a): a is { id: string, src: string } => a !== null);

  const resolveAttachmentDataUrls = async (): Promise<string[]> => {
    if (resolvedAttachments.length === 0) {
      return [];
    }
    return Promise.all(resolvedAttachments.map((att) => ensureDataUrl(att.src)));
  };

  const resolveAttachmentRefs = async (): Promise<string[]> => {
    const refs: string[] = [];

    for (const att of attachments) {
      if (att.type === 'canvas') {
        const img = imageIndex.get(att.content);
        if (!img?.src) {
          continue;
        }
        const ref = toImageRef(img.src);
        if (isImageRef(ref)) {
          refs.push(ref);
        } else if (isDataUrl(ref)) {
          refs.push(await storeImage(ref));
        } else if (ref) {
          refs.push(ref);
        }
        continue;
      }

      const ref = toImageRef(att.content);
      if (isImageRef(ref)) {
        refs.push(ref);
      } else if (isDataUrl(ref)) {
        refs.push(await storeImage(ref));
      } else if (ref) {
        refs.push(ref);
      }
    }

    return refs;
  };

  // --- File Handling Logic ---


  // 辅助函数：检查图片是否已存在于 attachments 中
  const isImageAlreadyAttached = (src: string): boolean => {
    const target = toImageRef(src);
    return attachments.some(att => {
      if (att.type === 'local' || att.type === 'url') {
        return toImageRef(att.content) === target;
      }
      if (att.type === 'canvas') {
        const img = imageIndex.get(att.content);
        return img ? toImageRef(img.src) === target : false;
      }
      return false;
    });
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      addMessage('model', '请上传图片文件。', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      if (base64) {
        try {
          const imageRef = await storeImage(base64);
          // 检查图片是否已存在
          if (isImageAlreadyAttached(imageRef)) {
            // 图片已存在，不重复添加
            return;
          }
          // Add as attachment, do NOT put on canvas
          setAttachments(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            type: 'url',
            content: imageRef
          }]);
        } catch (error) {
          console.error('Failed to store image:', error);
          addMessage('model', '图片存储失败，请重试。', 'error');
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      Array.from(e.target.files).forEach((file: File) => processFile(file));
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) processFile(file);
        return;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    // 优先处理从画布拖拽的图片
    const canvasImageId = e.dataTransfer.getData('application/canvas-image');
    const canvasImageSrc = e.dataTransfer.getData('text/plain');
    
    if (canvasImageId || canvasImageSrc) {
      // 从画布拖拽的图片：查找对应的图片数据
      if (canvasImageId) {
        const canvasImage = images.find(img => img.id === canvasImageId);
        if (canvasImage) {
          void handleAddToReference(canvasImage.src);
          return;
        }
      }
      // 如果找不到 ID，尝试使用直接传递的数据
      if (canvasImageSrc && (isDataUrl(canvasImageSrc) || isImageRef(canvasImageSrc))) {
        void handleAddToReference(canvasImageSrc);
        return;
      }
    }
    
    // 处理文件拖拽（原有逻辑）
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((file: File) => processFile(file));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    
    // 检查是否是从画布拖拽的图片
    const isCanvasImage = e.dataTransfer.types.includes('application/canvas-image') || 
                          e.dataTransfer.types.includes('text/plain');
    
    if (isCanvasImage || e.dataTransfer.files.length > 0) {
    setIsDragging(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // 只有当真正离开输入区域时才取消拖拽状态
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!currentTarget.contains(relatedTarget)) {
    setIsDragging(false);
    }
  };

  const handleReusePrompt = (text: string, msgImages?: string[]) => {
    setInputValue(text);
    if (msgImages && msgImages.length > 0) {
      const recoveredAttachments: Attachment[] = msgImages.map((src) => {
        const normalized = toImageRef(src);
        return {
          id: Math.random().toString(36).substr(2, 9),
          type: isDataUrl(normalized) ? 'local' : 'url',
          content: normalized
        };
      });
      setAttachments(recoveredAttachments);
    }
    textareaRef.current?.focus();
  };

  const handleAddToReference = async (src: string) => {
    try {
      const normalized = toImageRef(src);
      const imageRef = isImageRef(normalized)
        ? normalized
        : isDataUrl(normalized)
        ? await storeImage(normalized)
        : normalized;

      if (isImageAlreadyAttached(imageRef)) {
        return;
      }

      setAttachments(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        type: isDataUrl(imageRef) ? 'local' : 'url',
        content: imageRef
      }]);
    } catch (error) {
      console.error('Failed to add reference image:', error);
      addMessage('model', '参考图添加失败，请重试。', 'error');
    }
  };

  // --- Prompt Enhancement ---
  const handleEnhancePrompt = async () => {
    // Allow enhance if there is text OR attachments
    // 不允许在请求进行中或正在优化时执行
    if ((!inputValue.trim() && resolvedAttachments.length === 0) || isEnhancing || isRequestActive) return;
    
    // 如果已有增强请求在进行中，取消它
    if (currentEnhanceRequest) {
      currentEnhanceRequest.abort();
      setCurrentEnhanceRequest(null);
    }
    
    setIsEnhancing(true);
    try {
      const currentBase64s = await resolveAttachmentDataUrls();
      // 使用可取消的增强方法
      const enhanceRequest = enhancePromptCancellable(inputValue, currentBase64s);
      setCurrentEnhanceRequest(enhanceRequest);
      
      const enhancedText = await enhanceRequest.promise;
      
      // 检查请求是否已被取消
      if (enhanceRequest.isAborted()) {
        return;
      }
      
      setInputValue(enhancedText);
    } catch (err: any) {
      // 检查是否是取消错误
      if (err?.message === 'Request was cancelled' || currentEnhanceRequest?.isAborted()) {
        return;
      }
      console.error("Enhance failed", err);
      // Optional: show toast
    } finally {
      setIsEnhancing(false);
      setCurrentEnhanceRequest(null);
      textareaRef.current?.focus();
    }
  };

  // --- Submission Logic ---

  /**
   * 取消当前请求
   */
  const handleCancelRequest = () => {
    // 取消主请求（生成/编辑）
    if (currentRequest) {
      // 先标记为已取消，防止重复取消
      const requestToCancel = currentRequest;
      setCurrentRequest(null);
      setIsRequestActive(false);
      
      // 精确移除当前加载指示器
      const loadingId = currentLoadingIdRef.current;
      if (loadingId) {
        setMessages(prev => prev.filter(msg => msg.id !== loadingId));
        currentLoadingIdRef.current = null;
      }
      
      // 取消请求
      requestToCancel.abort();
      
      addMessage('model', '请求已取消', 'error');
    } else if (isRequestActive) {
      // 如果没有 currentRequest 但 isRequestActive 为 true，直接重置状态
      setIsRequestActive(false);
      const loadingId = currentLoadingIdRef.current;
      if (loadingId) {
        setMessages(prev => prev.filter(msg => msg.id !== loadingId));
        currentLoadingIdRef.current = null;
      }
    }
    
    // 取消增强请求
    if (currentEnhanceRequest) {
      currentEnhanceRequest.abort();
      setCurrentEnhanceRequest(null);
      setIsEnhancing(false);
    }
  };

  /**
   * 处理提交（带防抖）
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 防抖处理：清除之前的定时器
    if (submitDebounceRef.current) {
      clearTimeout(submitDebounceRef.current);
    }
    
    // 如果请求正在进行中，点击按钮应该取消请求
    if (isRequestActive && currentRequest) {
      handleCancelRequest();
      return;
    }
    
    // 防抖：延迟 300ms 执行，防止快速多次点击
    submitDebounceRef.current = setTimeout(async () => {
      if (!inputValue.trim() && resolvedAttachments.length === 0) return;
      // 如果已有请求在进行中，不重复发起
      if (isRequestActive) return;

      const currentInput = inputValue;
      let currentBase64s: string[] = [];
      let currentImageRefs: string[] = [];
      try {
        // Resolve current attachments to data URLs for the API
        currentBase64s = await resolveAttachmentDataUrls();
        currentImageRefs = await resolveAttachmentRefs();
      } catch (error) {
        console.error('Failed to resolve attachments:', error);
        addMessage('model', '附件读取失败，请重试', 'error');
        return;
      }
      setInputValue('');

      // 1. Add User Message
      addMessage('user', currentInput, 'text', currentImageRefs);
      setAttachments([]); // Clear attachments after use

      // 2. Add Loading Indicator
      const loadingId = 'loading-' + Date.now();
      currentLoadingIdRef.current = loadingId; // 保存当前加载消息 ID
      setMessages(prev => [...prev, {
        id: loadingId,
        role: 'model',
        type: 'system',
        text: '正在生成中...',
        timestamp: Date.now()
      }]);

      // 3. 创建可取消的请求（使用真正的可取消 AI 服务方法）
      setIsRequestActive(true);
      let request: CancellableRequest<string>;
      
      // 直接使用可取消的 AI 服务方法，支持真正的后端取消
      if (currentBase64s.length > 0) {
        // Edit/Ref Mode - 使用可取消的编辑方法
        request = editMultiImagesCancellable(
          currentBase64s,
          currentInput,
          modelSettings.imageSize || undefined,
          modelSettings.aspectRatio || undefined
        );
      } else {
        // Generate Mode - 使用可取消的生成方法
        request = generateImageCancellable(
          currentInput,
          modelSettings,
          undefined, // referenceImage
          undefined  // sketchImage
        );
      }
      
      setCurrentRequest(request);
      
      try {
        // 等待请求完成
        const resultImageRef = await request.promise;
        
        // 检查请求是否已被取消
        if (request.isAborted()) {
          // 移除加载指示器（如果还存在）
          if (currentLoadingIdRef.current === loadingId) {
            setMessages(prev => prev.filter(msg => msg.id !== loadingId));
            currentLoadingIdRef.current = null;
          }
          return;
        }
        
        // 4. Success: Remove loading and add result message with image
        if (currentLoadingIdRef.current === loadingId) {
          setMessages(prev => prev.filter(msg => msg.id !== loadingId));
          currentLoadingIdRef.current = null;
        }
        
        // 添加结果到画布
        onAddToCanvas(resultImageRef);
        
        // 添加成功消息
        addMessage('model', '生成完成', 'text', [resultImageRef]);

      } catch (err: any) {
        // 检查是否是取消错误
        if (request.isAborted() || err?.message === 'Request was cancelled' || currentRequest?.isAborted()) {
          // 移除加载指示器（如果还存在）
          if (currentLoadingIdRef.current === loadingId) {
            setMessages(prev => prev.filter(msg => msg.id !== loadingId));
            currentLoadingIdRef.current = null;
          }
          return;
        }
        
        // 5. Error: Remove loading and add error message
        if (currentLoadingIdRef.current === loadingId) {
          setMessages(prev => prev.filter(msg => msg.id !== loadingId));
          currentLoadingIdRef.current = null;
        }
        addMessage('model', '抱歉，处理您的请求时出现错误。', 'error');
        console.error(err);
      } finally {
        // 清理请求状态
        setCurrentRequest(null);
        setIsRequestActive(false);
        // 确保清理 loadingId（防止内存泄漏）
        if (currentLoadingIdRef.current === loadingId) {
          currentLoadingIdRef.current = null;
        }
      }
    }, 300); // 300ms 防抖延迟
  };
  
  
  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (submitDebounceRef.current) {
        clearTimeout(submitDebounceRef.current);
      }
    };
  }, []);

  // 清除聊天历史记录
  const handleClearChatHistory = () => {
    setConfirmDialog({
      isOpen: true,
      type: 'warning',
      title: '清除聊天历史',
      message: '确定要清除所有聊天历史记录吗？此操作无法撤销。',
      confirmText: '确定清除',
      cancelText: '取消',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        try {
          await clearChatHistory();
          // 清除后重置为欢迎消息
          setMessages([
            { 
              id: '1', 
              role: 'model', 
              type: 'text',
              text: '欢迎使用ArtifexBot。输入提示词即可生成和编辑图片。', 
              timestamp: Date.now() 
            }
          ]);
          // 更新消息快照
          prevMessagesRef.current = [
            {
              id: '1',
              role: 'model',
              type: 'text',
              text: '欢迎使用ArtifexBot。输入提示词即可生成和编辑图片。',
              timestamp: Date.now(),
              images: undefined
            }
          ];
          // 重置消息数量记录
          prevMessagesCountRef.current = 1;
        } catch (error) {
          console.error('Failed to clear chat history:', error);
          // 显示错误提示
          setConfirmDialog({
            isOpen: true,
            type: 'alert',
            title: '清除失败',
            message: '清除历史记录失败，请重试。',
            confirmText: '确定',
            onConfirm: () => {
              setConfirmDialog(prev => ({ ...prev, isOpen: false }));
            }
          });
        }
      }
    });
  };

  const ratios: { label: string, value: AspectRatio, icon: React.ElementType }[] = [
    { label: '1:1', value: '1:1', icon: Square },
    { label: '16:9', value: '16:9', icon: RectangleHorizontal },
    { label: '9:16', value: '9:16', icon: RectangleVertical },
    { label: '4:3', value: '4:3', icon: RectangleHorizontal }, // Reuse icon but different label
    { label: '3:4', value: '3:4', icon: RectangleVertical },
  ];

  const sizes: ImageSize[] = ['1K', '2K', '4K'];

  return (
    <>
      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        type={confirmDialog.type}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
      
      <div className="relative h-full bg-slate-950 flex flex-col overflow-hidden w-[420px] border-r border-slate-800">
      {/* Main Content Wrapper */}
      <div className="w-[420px] h-full flex flex-col relative">

          {/* Chat History Header with Clear Button */}
          {messages.some(msg => msg.role === 'user') && (
            <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-slate-800/50">
              <div className="text-xs text-slate-500 font-medium">
                聊天历史 ({messages.filter(msg => msg.role === 'user').length} 条对话)
              </div>
              <button
                onClick={handleClearChatHistory}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors group"
                title="清除聊天历史"
              >
                <Trash2 size={14} className="group-hover:scale-110 transition-transform" />
                <span>清除</span>
              </button>
            </div>
          )}

          {/* Chat History */}
          <div
            className="flex-1 overflow-y-auto px-5 py-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
            onMouseEnter={() => setIsAutoScrollPaused(true)}
            onMouseLeave={() => {
              setIsAutoScrollPaused(false);
              scrollToBottom('smooth');
            }}
          >
            {messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group/message`}
              >
                <div className={`relative max-w-[95%] ${msg.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
                  
                  {/* Model Label (Outside Bubble) */}
                  {msg.role === 'model' && msg.type === 'text' && (
                    <div className="flex items-center gap-2 mb-1.5 ml-1 text-blue-400 text-xs font-bold uppercase tracking-wider opacity-80">
                      <Bot size={12} /> ArtifexBot
                    </div>
                  )}

                  <div 
                    className={`rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm transition-all ${
                      msg.type === 'system' ? 'bg-slate-800/30 text-slate-400 italic border border-slate-800/50 flex items-center gap-3 px-4 py-3' :
                      msg.type === 'error' ? 'bg-red-900/20 text-red-400 border border-red-900/30' :
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-br-sm shadow-blue-900/20' 
                        : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700/50 shadow-slate-900/50'
                    }`}
                  >

                     {/* Loading State Spinner */}
                     {msg.type === 'system' && msg.text.includes('正在') && (
                       <Loader2 size={16} className="animate-spin text-blue-400" />
                     )}
                    
                    {/* Thumbnails in Chat */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-3 mb-3 mt-1">
                        {msg.images.map((src, idx) => (
                          <div key={idx} className="relative group/image w-full aspect-square max-w-[280px] rounded-xl overflow-hidden border border-white/10 bg-black/30 shadow-lg">
                            <img src={normalizeAttachmentSrc(src)} className="w-full h-full object-contain" alt="result" />
                            
                             {/* Image Overlay Actions */}
                             <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/image:opacity-100 transition-all duration-200 flex flex-col items-center justify-center gap-3 backdrop-blur-[2px]">
                              <button 
                                onClick={() => onAddToCanvas(src)}
                                className="w-32 px-4 py-2 bg-blue-600/80 text-white rounded-lg hover:bg-blue-600 hover:text-white transition-all hover:scale-105 shadow-xl border border-blue-500/30 text-sm font-medium whitespace-nowrap"
                                title="添加到画布"
                              >
                                添加到画布
                              </button>
                               <button 
                                onClick={() => void handleAddToReference(src)}
                                className="w-32 px-4 py-2 bg-purple-600/80 text-white rounded-lg hover:bg-purple-600 hover:text-white transition-all hover:scale-105 shadow-xl border border-purple-500/30 text-sm font-medium whitespace-nowrap"
                                title="作为参考"
                              >
                                作为参考
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                  </div>

                  {/* Edit/Reuse Button */}
                  {msg.role === 'user' && (
                    <button 
                      onClick={() => handleReusePrompt(msg.text, msg.images)}
                      className="absolute -left-10 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 opacity-0 group-hover/message:opacity-100 transition-all transform hover:scale-110"
                      title="重新编辑"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}
                </div>
                
                <span className="text-[10px] text-slate-500 mt-1.5 px-2 opacity-60">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-5 bg-slate-950 border-t border-slate-800 z-20">
            <form onSubmit={handleSubmit} className="relative group/input">
              
              <div 
                className={`relative rounded-2xl transition-all duration-200 flex flex-col ${
                  isDragging ? 'ring-2 ring-blue-500 bg-slate-800' : 'bg-slate-900 border border-slate-700 hover:border-slate-600 focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-500/50'
                }`}
              >
                {/* Internal Attachment Preview */}
                {resolvedAttachments.length > 0 && (
                  <div className="flex items-center gap-3 overflow-x-auto p-3 border-b border-white/5 mx-1">
                    {resolvedAttachments.map((img) => (
                      <div key={img.id} className="relative group shrink-0">
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-slate-800 border border-slate-700 shadow-sm">
                          <img src={img.src} alt="Attachment" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <button 
                          type="button"
                          onClick={() => setAttachments(attachments.filter(a => a.id !== img.id))}
                          className="absolute -top-2 -right-2 bg-slate-700 text-slate-300 hover:bg-red-500 hover:text-white rounded-full p-1 transition-colors shadow-md border border-slate-600"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onPaste={handlePaste}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  placeholder={
                    resolvedAttachments.length > 0
                      ? "输入提示词..." 
                      : "输入提示词，或拖拽图片到这里..."
                  }
                  className="w-full bg-transparent p-4 text-base text-slate-200 placeholder:text-slate-500 focus:outline-none resize-none min-h-[50px] max-h-[200px] scrollbar-hide leading-normal"
                  rows={resolvedAttachments.length > 0 ? 2 : 3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                />
                
                {/* Bottom Toolbar */}
                <div className="flex items-center justify-between px-3 py-2.5 bg-slate-900/50 rounded-b-2xl relative">
                  {/* Left Actions (Upload & Settings) */}
                  <div className="flex items-center gap-2">
                     {!isProcessing && (
                       <>
                         <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="上传图片"
                         >
                           <Paperclip size={18} />
                         </button>
                         <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept="image/*"
                          multiple
                          onChange={handleFileSelect}
                         />

                         <div className="relative" ref={resPickerRef}>
                            <button
                              type="button"
                              onClick={() => setShowResPicker(!showResPicker)}
                              className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${
                                showResPicker ? 'text-blue-400 bg-slate-800' : 'text-slate-400 hover:text-blue-400 hover:bg-slate-800'
                              }`}
                              title="尺寸与分辨率"
                            >
                              <Monitor size={18} />
                              <span className="text-xs font-medium">
                                {resolvedAttachments.length > 0 && modelSettings.aspectRatio === "" && modelSettings.imageSize === ""
                                  ? '保持原图'
                                  : `${modelSettings.aspectRatio || (resolvedAttachments.length > 0 ? '原图' : '1:1')} · ${modelSettings.imageSize || (resolvedAttachments.length > 0 ? '原图' : '1K')}`}
                              </span>
                            </button>

                            {/* Resolution/Ratio Popover */}
                            {showResPicker && (
                              <div className="absolute bottom-full left-0 mb-3 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 p-4 animate-in fade-in zoom-in-95 duration-200">
                                {/* Aspect Ratio */}
                                <div className="mb-4">
                                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 block">宽高比</label>
                                  <div className="grid grid-cols-3 gap-2">
                                    {/* 保持原图选项 - 只在有参考图时显示 */}
                                    {resolvedAttachments.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setModelSettings({...modelSettings, aspectRatio: ""});
                                        }}
                                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${
                                          modelSettings.aspectRatio === "" 
                                            ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:border-slate-600'
                                        }`}
                                        title="保持原图宽高比"
                                      >
                                        <Image size={16} className="mb-1" />
                                        <span className="text-[10px]">原图</span>
                                      </button>
                                    )}
                                    {ratios.map(r => (
                                      <button
                                        key={r.value}
                                        type="button"
                                        onClick={() => {
                                          setModelSettings({...modelSettings, aspectRatio: r.value});
                                        }}
                                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${
                                          modelSettings.aspectRatio === r.value 
                                            ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:border-slate-600'
                                        }`}
                                      >
                                        <r.icon size={16} className="mb-1" />
                                        <span className="text-[10px]">{r.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Resolution */}
                                <div>
                                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 block">分辨率 (Image Size)</label>
                                  <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
                                    {/* 保持原图选项 - 只在有参考图时显示 */}
                                    {resolvedAttachments.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setModelSettings({...modelSettings, imageSize: ""})}
                                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                          modelSettings.imageSize === ""
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                        title="保持原图分辨率"
                                      >
                                        原图
                                      </button>
                                    )}
                                    {sizes.map(size => (
                                      <button
                                        key={size}
                                        type="button"
                                        onClick={() => setModelSettings({...modelSettings, imageSize: size})}
                                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                          modelSettings.imageSize === size
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                      >
                                        {size}
                                      </button>
                                    ))}
                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-2 px-1">
                                    注意: 2K/4K 分辨率将使用 Gemini 3 Pro 模型，消耗更多资源。
                                  </p>
                                </div>
                              </div>
                            )}
                         </div>
                       </>
                     )}
                  </div>

                  {/* Right Actions (Enhance, Send) */}
                  <div className="flex items-center gap-3">
                     {(inputValue.trim().length > 0 || resolvedAttachments.length > 0) && (
                      <button
                        type="button"
                        onClick={handleEnhancePrompt}
                        disabled={isEnhancing || isRequestActive}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border
                          ${isEnhancing || isRequestActive
                            ? 'bg-purple-900/20 text-purple-400 border-purple-500/30 cursor-wait opacity-50' 
                            : 'bg-purple-500/5 text-purple-400 border-purple-500/20 hover:bg-purple-500/10 hover:border-purple-500/40 hover:text-purple-300'
                          }`}
                        title={isRequestActive ? '请求进行中，无法优化' : 'AI 提示词增强'}
                      >
                        {isEnhancing ? <Sparkles size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        <span>{isEnhancing ? '优化中...' : '优化'}</span>
                      </button>
                     )}

                    <button
                      type="submit"
                      disabled={(!inputValue.trim() && resolvedAttachments.length === 0) && !isRequestActive}
                      onClick={(e) => {
                        // 如果请求正在进行中，点击应该取消请求
                        if (isRequestActive) {
                          e.preventDefault();
                          handleCancelRequest();
                          return;
                        }
                        // 否则正常提交
                        handleSubmit(e);
                      }}
                      className={`p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center
                        ${(!inputValue.trim() && resolvedAttachments.length === 0) && !isRequestActive
                          ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                          : isRequestActive
                          ? 'bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-600/20 transform hover:scale-105 active:scale-95'
                          : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20 transform hover:scale-105 active:scale-95'}`}
                      title={isRequestActive ? '点击取消请求' : '发送请求'}
                    >
                      {isRequestActive ? (
                        <StopIcon size={18} className="text-white" />
                      ) : (
                        <Send size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Drag Overlay */}
                {isDragging && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 rounded-2xl backdrop-blur-sm pointer-events-none z-50 border-2 border-blue-500 border-dashed">
                    <div className="text-blue-400 font-bold flex flex-col items-center gap-2">
                      <Paperclip size={28} />
                      <span className="text-sm">松开以添加参考图</span>
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
