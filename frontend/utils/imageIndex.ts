/**
 * 图片索引工具
 * 使用 Map 建立 id -> image 的索引，加速查找和比较操作
 * 
 * 性能优化：
 * - O(1) 查找：通过 id 快速查找图片
 * - O(n) 比较：使用索引快速比较两个数组的差异
 * - 内存优化：只存储关键字段的哈希值，不存储完整图片数据
 */

import { CanvasImage } from '../types';

/**
 * 图片关键字段的哈希值（用于快速比较）
 */
interface ImageHash {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  prompt: string;
}

/**
 * 图片索引类
 * 维护 id -> image 的映射，以及 id -> hash 的映射
 */
export class ImageIndex {
  private idToImage: Map<string, CanvasImage>;
  private idToHash: Map<string, ImageHash>;
  private sortedIds: string[]; // 按 zIndex 排序的 id 数组

  constructor(images: CanvasImage[] = []) {
    this.idToImage = new Map();
    this.idToHash = new Map();
    this.sortedIds = [];
    this.rebuild(images);
  }

  /**
   * 重建索引
   * @param images 图片数组
   */
  rebuild(images: CanvasImage[]): void {
    this.idToImage.clear();
    this.idToHash.clear();
    this.sortedIds = [];

    images.forEach(img => {
      this.idToImage.set(img.id, img);
      this.idToHash.set(img.id, this.createHash(img));
    });

    // 按 zIndex 排序
    this.sortedIds = images
      .map(img => img.id)
      .sort((a, b) => {
        const imgA = this.idToImage.get(a)!;
        const imgB = this.idToImage.get(b)!;
        return imgA.zIndex - imgB.zIndex;
      });
  }

  /**
   * 创建图片的哈希值（只包含关键字段）
   */
  private createHash(img: CanvasImage): ImageHash {
    return {
      id: img.id,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      zIndex: img.zIndex,
      prompt: img.prompt
    };
  }

  /**
   * 通过 id 快速查找图片（O(1)）
   */
  get(id: string): CanvasImage | undefined {
    return this.idToImage.get(id);
  }

  /**
   * 批量查找图片（O(n)）
   */
  getMany(ids: string[]): CanvasImage[] {
    return ids
      .map(id => this.idToImage.get(id))
      .filter((img): img is CanvasImage => img !== undefined);
  }

  /**
   * 检查图片是否存在（O(1)）
   */
  has(id: string): boolean {
    return this.idToImage.has(id);
  }

  /**
   * 获取所有图片（按 zIndex 排序）
   */
  getAll(): CanvasImage[] {
    return this.sortedIds
      .map(id => this.idToImage.get(id)!)
      .filter(img => img !== undefined);
  }

  /**
   * 获取所有 id（按 zIndex 排序）
   */
  getAllIds(): string[] {
    return [...this.sortedIds];
  }

  /**
   * 获取索引大小
   */
  size(): number {
    return this.idToImage.size;
  }

  /**
   * 比较两个索引，返回是否有变化
   * 只比较关键字段，不比较 base64 src
   * 
   * @param other 另一个索引
   * @returns 是否有变化
   */
  hasChanged(other: ImageIndex): boolean {
    // 快速比较：长度不同
    if (this.size() !== other.size()) {
      return true;
    }

    // 快速比较：id 集合不同
    const thisIds = new Set(this.idToHash.keys());
    const otherIds = new Set(other.idToHash.keys());
    
    if (thisIds.size !== otherIds.size) {
      return true;
    }

    // 检查是否有新增或删除的 id
    for (const id of thisIds) {
      if (!otherIds.has(id)) {
        return true;
      }
    }

    // 比较每个图片的关键字段
    for (const id of thisIds) {
      const thisHash = this.idToHash.get(id)!;
      const otherHash = other.idToHash.get(id)!;

      if (
        thisHash.x !== otherHash.x ||
        thisHash.y !== otherHash.y ||
        thisHash.width !== otherHash.width ||
        thisHash.height !== otherHash.height ||
        thisHash.zIndex !== otherHash.zIndex ||
        thisHash.prompt !== otherHash.prompt
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取变化的图片 id 列表
   * @param other 另一个索引
   * @returns 变化的图片 id 数组
   */
  getChangedIds(other: ImageIndex): string[] {
    const changedIds: string[] = [];
    const thisIds = new Set(this.idToHash.keys());
    const otherIds = new Set(other.idToHash.keys());

    // 检查新增和删除
    for (const id of thisIds) {
      if (!otherIds.has(id)) {
        changedIds.push(id);
      }
    }

    for (const id of otherIds) {
      if (!thisIds.has(id)) {
        changedIds.push(id);
      }
    }

    // 检查修改
    for (const id of thisIds) {
      if (otherIds.has(id)) {
        const thisHash = this.idToHash.get(id)!;
        const otherHash = other.idToHash.get(id)!;

        if (
          thisHash.x !== otherHash.x ||
          thisHash.y !== otherHash.y ||
          thisHash.width !== otherHash.width ||
          thisHash.height !== otherHash.height ||
          thisHash.zIndex !== otherHash.zIndex ||
          thisHash.prompt !== otherHash.prompt
        ) {
          changedIds.push(id);
        }
      }
    }

    return changedIds;
  }
}

/**
 * 创建图片索引的辅助函数
 */
export function createImageIndex(images: CanvasImage[]): ImageIndex {
  return new ImageIndex(images);
}

/**
 * 快速比较两个图片数组是否有变化（使用索引）
 * @param prevImages 之前的图片数组
 * @param currentImages 当前的图片数组
 * @returns 是否有变化
 */
export function hasImagesChanged(
  prevImages: CanvasImage[],
  currentImages: CanvasImage[]
): boolean {
  // 快速比较：长度不同
  if (prevImages.length !== currentImages.length) {
    return true;
  }

  // 如果数组为空，直接返回 false
  if (prevImages.length === 0) {
    return false;
  }

  // 创建索引进行比较
  const prevIndex = new ImageIndex(prevImages);
  const currentIndex = new ImageIndex(currentImages);

  return prevIndex.hasChanged(currentIndex);
}

