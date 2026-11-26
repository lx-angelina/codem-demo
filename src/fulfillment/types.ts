// 前置仓履约演示模块领域模型（纯前端、内存态）

/** 订单状态：已支付待拣货 → 拣货中 → 待配送 → 配送中 → 已送达，旁路 已取消 / 缺货取消 */
export type OrderStatus =
  | "PAID_WAIT_PICK"
  | "PICKING"
  | "WAIT_DELIVERY"
  | "DELIVERING"
  | "DELIVERED"
  | "CANCELLED"
  | "OUT_OF_STOCK";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PAID_WAIT_PICK: "已支付待拣货",
  PICKING: "拣货中",
  WAIT_DELIVERY: "待配送",
  DELIVERING: "配送中",
  DELIVERED: "已送达",
  CANCELLED: "已取消",
  OUT_OF_STOCK: "缺货取消",
};

/** 操作角色，写入订单时间轴 */
export type ActorRole = "消费者" | "仓内作业" | "配送员" | "运营" | "系统";

export interface Point {
  x: number;
  y: number;
}

/** 收货地址，坐标为平面示意坐标（服务单位） */
export interface DeliveryAddress extends Point {
  label: string;
}

export interface OpenHours {
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
}

export interface StockItem {
  sku: string;
  name: string;
  price: number;
  stock: number;
}

export interface Warehouse {
  id: string;
  name: string;
  address: string;
  x: number;
  y: number;
  /** 服务半径（服务单位） */
  radius: number;
  openHours: OpenHours;
  isOpen: boolean;
  stock: StockItem[];
}

/** 新增/编辑仓档案时提交的表单草稿（数值项允许字符串输入） */
export interface WarehouseDraft {
  id?: string;
  name: string;
  address: string;
  radius: string | number;
  openHours: OpenHours;
  x?: number;
  y?: number;
}

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export interface OrderEvent {
  status: OrderStatus;
  role: ActorRole;
  /** 时间戳，HH:MM:SS */
  at: string;
  note: string;
}

export interface Order {
  id: string;
  address: DeliveryAddress;
  items: OrderItem[];
  warehouseId: string;
  warehouseName: string;
  status: OrderStatus;
  /** 预计送达分钟数 */
  etaMinutes: number;
  events: OrderEvent[];
  /** 取消/缺货原因 */
  cancelReason?: string;
}

export interface StockShortage {
  sku: string;
  name: string;
  required: number;
  available: number;
}
