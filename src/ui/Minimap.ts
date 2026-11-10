import type { Vector3 } from 'three';
import type { ArenaBuildResult, ArenaCollider } from '../level/ArenaBuilder';
import type { EnemyView } from '../enemies/types';

const PAD = 12;
const FRAME_MS = 80;

/**
 * Hand-drawn floor plan of the construction arena: walls once on a static
 * layer, then the player arrow and living enemies at ~12fps.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticLayer: HTMLCanvasElement;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly scale: number;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private lastDraw = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    arena: ArenaBuildResult,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Minimap: 2D context unavailable');
    this.ctx = ctx;

    const walls = arena.colliders.filter((collider) => collider.enabled && collider.category !== 'ground');
    // Bound the plan by the navigation graph: decorative backdrop colliders sit
    // far outside the arena and would shrink the playable plan to a dot.
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const node of arena.waypointGraph.nodes) {
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x);
      minZ = Math.min(minZ, node.position.z);
      maxZ = Math.max(maxZ, node.position.z);
    }
    if (!Number.isFinite(minX)) {
      minX = -36;
      maxX = 36;
      minZ = -39;
      maxZ = 39;
    }
    const margin = 7;
    minX -= margin;
    maxX += margin;
    minZ -= margin;
    maxZ += margin;
    this.bounds = { minX, maxX, minZ, maxZ };
    this.minX = minX;
    this.minZ = minZ;
    const w = maxX - minX || 1;
    const h = maxZ - minZ || 1;
    this.scale = Math.min((canvas.width - PAD * 2) / w, (canvas.height - PAD * 2) / h);

    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = canvas.width;
    this.staticLayer.height = canvas.height;
    const layer = this.staticLayer.getContext('2d');
    if (!layer) throw new Error('Minimap: 2D context unavailable');
    layer.fillStyle = 'rgba(246, 240, 220, 0.96)';
    layer.fillRect(0, 0, this.staticLayer.width, this.staticLayer.height);
    const areaX = this.toX(this.bounds.minX);
    const areaY = this.toY(this.bounds.minZ);
    const areaW = (this.bounds.maxX - this.bounds.minX) * this.scale;
    const areaH = (this.bounds.maxZ - this.bounds.minZ) * this.scale;
    layer.fillStyle = 'rgba(39, 52, 143, 0.045)';
    layer.fillRect(areaX, areaY, areaW, areaH);
    layer.strokeStyle = 'rgba(39, 52, 143, 0.09)';
    layer.lineWidth = 0.8;
    const grid = 10 * this.scale;
    for (let gx = areaX + grid; gx < areaX + areaW; gx += grid) {
      layer.beginPath(); layer.moveTo(gx, areaY); layer.lineTo(gx, areaY + areaH); layer.stroke();
    }
    for (let gy = areaY + grid; gy < areaY + areaH; gy += grid) {
      layer.beginPath(); layer.moveTo(areaX, gy); layer.lineTo(areaX + areaW, gy); layer.stroke();
    }
    layer.save();
    layer.setLineDash([4, 3]);
    layer.strokeStyle = 'rgba(39, 52, 143, 0.4)';
    layer.lineWidth = 1.2;
    layer.strokeRect(areaX, areaY, areaW, areaH);
    layer.restore();
    layer.lineWidth = 1;
    for (const collider of walls) {
      if (collider.max.x < this.bounds.minX || collider.min.x > this.bounds.maxX) continue;
      if (collider.max.z < this.bounds.minZ || collider.min.z > this.bounds.maxZ) continue;
      this.drawCollider(layer, collider);
    }
    this.drawSupplies(layer, arena);
    this.drawRoomBorder(layer);
    this.drawNorth(layer);
  }

  private toX(x: number): number {
    return PAD + (x - this.minX) * this.scale;
  }

  private toY(z: number): number {
    return PAD + (z - this.minZ) * this.scale;
  }

  private drawCollider(layer: CanvasRenderingContext2D, collider: ArenaCollider): void {
    const x = this.toX(collider.min.x);
    const y = this.toY(collider.min.z);
    const w = Math.max(4.2, (collider.max.x - collider.min.x) * this.scale);
    const h = Math.max(4.2, (collider.max.z - collider.min.z) * this.scale);
    const category = collider.category;
    if (category === 'step') return;
    if (category === 'platform') {
      layer.strokeStyle = 'rgba(39, 52, 143, 0.34)';
      layer.strokeRect(x, y, w, h);
      return;
    }
    if (category === 'breakable') {
      layer.save();
      layer.setLineDash([2.5, 2.5]);
      layer.strokeStyle = 'rgba(214, 59, 85, 0.7)';
      layer.strokeRect(x, y, w, h);
      layer.restore();
      return;
    }
    if (category === 'cover') {
      layer.fillStyle = 'rgba(39, 52, 143, 0.28)';
      layer.fillRect(x, y, w, h);
      return;
    }
    // walls and columns: solid ink, with a hatch pass for the drawn feel.
    layer.fillStyle = 'rgba(39, 52, 143, 0.78)';
    layer.fillRect(x, y, w, h);
    if (w > 7 && h > 7) {
      layer.save();
      layer.beginPath();
      layer.rect(x, y, w, h);
      layer.clip();
      layer.strokeStyle = 'rgba(246, 240, 220, 0.5)';
      layer.lineWidth = 0.8;
      for (let d = -h; d < w; d += 5) {
        layer.beginPath();
        layer.moveTo(x + d, y + h);
        layer.lineTo(x + d + h, y);
        layer.stroke();
      }
      layer.restore();
    }
  }

  private drawSupplies(layer: CanvasRenderingContext2D, arena: ArenaBuildResult): void {
    for (const supply of arena.supplyPoints) {
      const x = this.toX(supply.position.x);
      const y = this.toY(supply.position.z);
      layer.save();
      layer.translate(x, y);
      layer.rotate(Math.PI / 4);
      layer.fillStyle = 'rgba(105, 184, 135, 0.95)';
      layer.fillRect(-2.6, -2.6, 5.2, 5.2);
      layer.strokeStyle = 'rgba(39, 52, 143, 0.45)';
      layer.lineWidth = 0.8;
      layer.strokeRect(-2.6, -2.6, 5.2, 5.2);
      layer.restore();
    }
  }

  private drawRoomBorder(layer: CanvasRenderingContext2D): void {
    layer.strokeStyle = 'rgba(39, 52, 143, 0.5)';
    layer.lineWidth = 1.5;
    layer.strokeRect(PAD, PAD, this.canvas.width - PAD * 2, this.canvas.height - PAD * 2);
  }

  private drawNorth(layer: CanvasRenderingContext2D): void {
    layer.fillStyle = 'rgba(39, 52, 143, 0.55)';
    layer.font = '700 11px "ZCOOL KuaiLe", cursive';
    layer.textAlign = 'center';
    layer.fillText('北', this.canvas.width / 2, 11);
  }

  update(realDelta: number, player: Vector3, yaw: number, enemies: readonly EnemyView[]): void {
    const now = performance.now();
    if (now - this.lastDraw < FRAME_MS) return;
    this.lastDraw = now;
    void realDelta;

    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.staticLayer, 0, 0);

    for (const enemy of enemies) {
      const isBoss = enemy.kind === 'boss';
      ctx.beginPath();
      ctx.arc(this.toX(enemy.position.x), this.toY(enemy.position.z), isBoss ? 5 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = isBoss ? 'rgba(214, 59, 85, 1)' : 'rgba(214, 59, 85, 0.9)';
      ctx.fill();
      if (isBoss) {
        ctx.beginPath();
        ctx.arc(this.toX(enemy.position.x), this.toY(enemy.position.z), 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(214, 59, 85, 0.7)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    const px = this.toX(player.x);
    const py = this.toY(player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5.2, 5.4);
    ctx.lineTo(0, 2.8);
    ctx.lineTo(-5.2, 5.4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(39, 52, 143, 1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(39, 52, 143, 0.35)';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(246, 240, 220, 0.95)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}
