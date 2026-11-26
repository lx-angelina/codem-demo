// useReducer 驱动的履约状态容器：UI 只派发意图，状态变更全部经过 reducer
import { useReducer } from "react";
import { DEMO_CATALOG, SEED_WAREHOUSES, findCatalogItem } from "./data";
import {
  normalizeWarehouseDraft,
  placeOrder,
  releaseStock,
  requestCancel,
  transition,
  validateWarehouse,
  type OrderActionType,
} from "./engine";
import type { DeliveryAddress, Order, OrderItem, Warehouse, WarehouseDraft } from "./types";

export interface Notice {
  kind: "success" | "error" | "info";
  text: string;
}

export interface FulfillmentState {
  warehouses: Warehouse[];
  orders: Order[];
  cart: Record<string, number>;
  address: DeliveryAddress;
  notice: Notice | null;
  seq: number;
}

export type FulfillmentAction =
  | { type: "ADD_TO_CART"; sku: string }
  | { type: "SET_CART_QTY"; sku: string; qty: number }
  | { type: "CLEAR_CART" }
  | { type: "SET_ADDRESS"; address: DeliveryAddress }
  | { type: "PLACE_ORDER"; at: string }
  | { type: "SAVE_WAREHOUSE"; draft: WarehouseDraft; at: string }
  | { type: "TOGGLE_WAREHOUSE"; id: string }
  | { type: "ORDER_ACTION"; orderId: string; action: OrderActionType; at: string }
  | { type: "CANCEL_ORDER"; orderId: string; at: string }
  | { type: "DISMISS_NOTICE" };

export function createInitialState(): FulfillmentState {
  return {
    warehouses: SEED_WAREHOUSES.map((warehouse) => ({
      ...warehouse,
      openHours: { ...warehouse.openHours },
      stock: warehouse.stock.map((item) => ({ ...item })),
    })),
    orders: [],
    cart: {},
    address: { label: "静安寺门店（范围内）", x: 1, y: 1 },
    notice: null,
    seq: 0,
  };
}

function cartToOrderItems(cart: Record<string, number>): OrderItem[] {
  return Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([sku, qty]) => {
      const catalogItem = findCatalogItem(sku);
      return {
        sku,
        name: catalogItem?.name ?? sku,
        price: catalogItem?.price ?? 0,
        qty,
      };
    });
}

function updateOrder(state: FulfillmentState, orderId: string, nextOrder: Order): FulfillmentState {
  return {
    ...state,
    orders: state.orders.map((order) => (order.id === orderId ? nextOrder : order)),
  };
}

export function fulfillmentReducer(state: FulfillmentState, action: FulfillmentAction): FulfillmentState {
  switch (action.type) {
    case "ADD_TO_CART": {
      const current = state.cart[action.sku] ?? 0;
      return {
        ...state,
        notice: null,
        cart: { ...state.cart, [action.sku]: Math.min(current + 1, 9) },
      };
    }
    case "SET_CART_QTY": {
      const qty = Math.max(0, Math.min(action.qty, 9));
      return { ...state, notice: null, cart: { ...state.cart, [action.sku]: qty } };
    }
    case "CLEAR_CART":
      return { ...state, cart: {} };
    case "SET_ADDRESS":
      return { ...state, address: action.address, notice: null };
    case "PLACE_ORDER": {
      const items = cartToOrderItems(state.cart);
      const orderId = `PP-${String(state.seq + 1).padStart(4, "0")}`;
      const result = placeOrder({
        address: state.address,
        items,
        warehouses: state.warehouses,
        orderId,
        at: action.at,
      });
      if (!result.ok) {
        return { ...state, notice: { kind: "error", text: result.reason } };
      }
      return {
        ...state,
        warehouses: result.warehouses,
        orders: [result.order, ...state.orders],
        cart: {},
        seq: state.seq + 1,
        notice: {
          kind: "success",
          text: `下单成功，已分配 ${result.order.warehouseName}，预计 ${result.order.etaMinutes} 分钟送达`,
        },
      };
    }
    case "SAVE_WAREHOUSE": {
      const validation = validateWarehouse(action.draft);
      if (!validation.ok) {
        const firstError = Object.values(validation.errors)[0] ?? "表单校验未通过";
        return { ...state, notice: { kind: "error", text: firstError } };
      }
      const existing = action.draft.id
        ? state.warehouses.find((warehouse) => warehouse.id === action.draft.id)
        : undefined;
      const next = normalizeWarehouseDraft(action.draft, existing, DEMO_CATALOG);
      return {
        ...state,
        warehouses: existing
          ? state.warehouses.map((warehouse) => (warehouse.id === next.id ? next : warehouse))
          : [...state.warehouses, next],
        notice: { kind: "success", text: existing ? `已更新前置仓「${next.name}」` : `已新增前置仓「${next.name}」` },
      };
    }
    case "TOGGLE_WAREHOUSE": {
      const target = state.warehouses.find((warehouse) => warehouse.id === action.id);
      if (!target) return state;
      const isOpen = !target.isOpen;
      return {
        ...state,
        warehouses: state.warehouses.map((warehouse) =>
          warehouse.id === action.id ? { ...warehouse, isOpen } : warehouse,
        ),
        notice: {
          kind: "info",
          text: `${target.name}已切换为${isOpen ? "营业中" : "闭店"}`,
        },
      };
    }
    case "ORDER_ACTION": {
      const order = state.orders.find((entry) => entry.id === action.orderId);
      if (!order) return state;
      const result = transition(order, action.action, action.at);
      if (!result.ok) {
        return { ...state, notice: { kind: "error", text: `${order.id}：${result.reason}` } };
      }
      const releasesStock = result.order.status === "OUT_OF_STOCK";
      const nextState = updateOrder(state, order.id, result.order);
      return {
        ...nextState,
        warehouses: releasesStock ? releaseStock(state.warehouses, order.items) : state.warehouses,
        notice: {
          kind: releasesStock ? "info" : "success",
          text: releasesStock
            ? `${order.id}：缺货取消，已释放锁定库存`
            : `${order.id}：${result.order.events[result.order.events.length - 1].note}`,
        },
      };
    }
    case "CANCEL_ORDER": {
      const order = state.orders.find((entry) => entry.id === action.orderId);
      if (!order) return state;
      const result = requestCancel(order, action.at);
      if (!result.ok) {
        return { ...state, notice: { kind: "error", text: `${order.id}：${result.reason}` } };
      }
      const nextState = updateOrder(state, order.id, result.order);
      return {
        ...nextState,
        warehouses: releaseStock(state.warehouses, order.items),
        notice: {
          kind: "success",
          text: `${order.id}：已取消，库存已恢复，已原路退款（模拟）`,
        },
      };
    }
    case "DISMISS_NOTICE":
      return { ...state, notice: null };
    default:
      return state;
  }
}

export function useFulfillmentStore() {
  const [state, dispatch] = useReducer(fulfillmentReducer, undefined, createInitialState);
  return { state, dispatch };
}
