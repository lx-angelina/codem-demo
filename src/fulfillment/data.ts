// 演示种子数据：商品目录、前置仓档案、预设收货地址
import type { DeliveryAddress, StockItem, Warehouse } from "./types";

export const DEMO_CATALOG: StockItem[] = [
  { sku: "SKU-AP01", name: "红富士苹果 500g", price: 12.9, stock: 0 },
  { sku: "SKU-MK01", name: "鲜牛奶 950ml", price: 15.5, stock: 0 },
  { sku: "SKU-BR01", name: "手撕吐司 400g", price: 9.9, stock: 0 },
  { sku: "SKU-EG01", name: "可生食鸡蛋 10 枚", price: 18.8, stock: 0 },
];

export function findCatalogItem(sku: string): StockItem | undefined {
  return DEMO_CATALOG.find((item) => item.sku === sku);
}

/** 种子前置仓：覆盖范围内 / 双仓命中取最近 / 闭店三类场景 */
export const SEED_WAREHOUSES: Warehouse[] = [
  {
    id: "WH-SH-01",
    name: "静安前置仓",
    address: "静安区南京西路 1266 号",
    x: 0,
    y: 0,
    radius: 5,
    openHours: { start: "07:00", end: "22:00" },
    isOpen: true,
    stock: [
      { sku: "SKU-AP01", name: "红富士苹果 500g", price: 12.9, stock: 8 },
      { sku: "SKU-MK01", name: "鲜牛奶 950ml", price: 15.5, stock: 2 },
      { sku: "SKU-BR01", name: "手撕吐司 400g", price: 9.9, stock: 7 },
      { sku: "SKU-EG01", name: "可生食鸡蛋 10 枚", price: 18.8, stock: 6 },
    ],
  },
  {
    id: "WH-SH-02",
    name: "徐汇前置仓",
    address: "徐汇区漕溪北路 88 号",
    x: 6,
    y: 4,
    radius: 4,
    openHours: { start: "08:00", end: "23:00" },
    isOpen: true,
    stock: [
      { sku: "SKU-AP01", name: "红富士苹果 500g", price: 12.9, stock: 9 },
      { sku: "SKU-MK01", name: "鲜牛奶 950ml", price: 15.5, stock: 5 },
      { sku: "SKU-BR01", name: "手撕吐司 400g", price: 9.9, stock: 4 },
      { sku: "SKU-EG01", name: "可生食鸡蛋 10 枚", price: 18.8, stock: 8 },
    ],
  },
  {
    id: "WH-PD-03",
    name: "浦东前置仓（休息中）",
    address: "浦东新区世纪大道 100 号",
    x: 12,
    y: 0,
    radius: 3,
    openHours: { start: "09:00", end: "18:00" },
    isOpen: false,
    stock: [
      { sku: "SKU-AP01", name: "红富士苹果 500g", price: 12.9, stock: 5 },
      { sku: "SKU-MK01", name: "鲜牛奶 950ml", price: 15.5, stock: 5 },
      { sku: "SKU-BR01", name: "手撕吐司 400g", price: 9.9, stock: 5 },
      { sku: "SKU-EG01", name: "可生食鸡蛋 10 枚", price: 18.8, stock: 5 },
    ],
  },
];

/** 预设收货地址：范围内 / 双仓命中 / 闭仓 / 范围外 */
export const PRESET_ADDRESSES: DeliveryAddress[] = [
  { label: "静安寺门店（范围内）", x: 1, y: 1 },
  { label: "徐汇中心（双仓命中，取最近）", x: 4, y: 2 },
  { label: "世纪大道（仅闭店仓覆盖）", x: 12, y: 1 },
  { label: "浦东机场（超出服务范围）", x: 20, y: 18 },
];
