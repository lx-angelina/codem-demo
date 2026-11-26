// 前置仓履约演示模块：四个业务视角（运营后台 / 消费者 / 仓内作业 / 配送员）
import { FormEvent, useMemo, useState } from "react";
import { DEMO_CATALOG, PRESET_ADDRESSES } from "./data";
import {
  ORDER_STATUS_LABELS,
  type DeliveryAddress,
  type Order,
  type OrderItem,
  type Warehouse,
  type WarehouseDraft,
} from "./types";
import { ETA_MINUTES, formatTime, isDeliveryTimeout, validateWarehouse } from "./engine";
import { useFulfillmentStore } from "./store";

type TabKey = "ops" | "consumer" | "warehouse" | "courier";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "ops", label: "运营后台", hint: "前置仓档案管理（REQ-001）" },
  { key: "consumer", label: "消费者", hint: "下单、分配结果与履约跟踪（REQ-002/004/005）" },
  { key: "warehouse", label: "仓内作业", hint: "拣货打包与缺货上报（REQ-003）" },
  { key: "courier", label: "配送员", hint: "接单配送与送达（REQ-004）" },
];

const emptyDraft = (): WarehouseDraft => ({
  name: "",
  address: "",
  radius: "",
  openHours: { start: "07:00", end: "22:00" },
  x: 0,
  y: 0,
});

function money(value: number): string {
  return `¥${value.toFixed(1)}`;
}

function orderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function StatusPill({ order }: { order: Order }) {
  return <span className={`ffl-status ffl-status--${order.status.toLowerCase()}`}>{ORDER_STATUS_LABELS[order.status]}</span>;
}

function OrderTimeline({ order }: { order: Order }) {
  return (
    <ol className="ffl-timeline">
      {order.events.map((event, index) => (
        <li key={`${event.status}-${index}`}>
          <span className="ffl-timeline-dot" aria-hidden="true" />
          <div>
            <b>{ORDER_STATUS_LABELS[event.status]}</b>
            <small>
              {event.role} · {event.at}
            </small>
            <p>{event.note}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function OrderSummary({ order }: { order: Order }) {
  return (
    <div className="ffl-order-meta">
      <span>收货地址：{order.address.label}</span>
      <span>所属前置仓：{order.warehouseName}</span>
      <span>预计送达：{order.etaMinutes} 分钟</span>
      <span>金额：{money(orderTotal(order.items))}</span>
    </div>
  );
}

function OrderLines({ order }: { order: Order }) {
  return (
    <ul className="ffl-order-lines">
      {order.items.map((item) => (
        <li key={item.sku}>
          <span>{item.name}</span>
          <small>
            {item.qty} × {money(item.price)}
          </small>
        </li>
      ))}
    </ul>
  );
}

export default function FulfillmentApp() {
  const { state, dispatch } = useFulfillmentStore();
  const [tab, setTab] = useState<TabKey>("consumer");
  const [draft, setDraft] = useState<WarehouseDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [activeWarehouseId, setActiveWarehouseId] = useState(state.warehouses[0]?.id ?? "");
  const [courierWarehouseId, setCourierWarehouseId] = useState("ALL");
  const [addressLabel, setAddressLabel] = useState(PRESET_ADDRESSES[0].label);
  const now = new Date();
  const at = formatTime(now);

  const validation = useMemo(() => validateWarehouse(draft), [draft]);
  const draftErrors = validation.ok ? {} : validation.errors;

  const cartItems = useMemo(
    () =>
      DEMO_CATALOG.map((item) => ({ ...item, qty: state.cart[item.sku] ?? 0 })).filter((item) => item.qty > 0),
    [state.cart],
  );
  const cartCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const cartAmount = cartItems.reduce((sum, item) => sum + item.qty * item.price, 0);

  const activeWarehouse = state.warehouses.find((warehouse) => warehouse.id === activeWarehouseId);
  const pickTasks = state.orders.filter(
    (order) =>
      (order.status === "PAID_WAIT_PICK" || order.status === "PICKING") &&
      (!activeWarehouse || order.warehouseId === activeWarehouse.id),
  );
  const courierOrders = state.orders.filter(
    (order) =>
      (order.status === "WAIT_DELIVERY" || order.status === "DELIVERING") &&
      (courierWarehouseId === "ALL" || order.warehouseId === courierWarehouseId),
  );

  const selectAddress = (label: string) => {
    const preset = PRESET_ADDRESSES.find((address) => address.label === label);
    if (!preset) return;
    setAddressLabel(label);
    dispatch({ type: "SET_ADDRESS", address: preset as DeliveryAddress });
  };

  const submitOrder = () => {
    if (cartCount === 0) return;
    dispatch({ type: "PLACE_ORDER", at });
  };

  const startEdit = (warehouse: Warehouse) => {
    setEditingId(warehouse.id);
    setAttempted(false);
    setDraft({
      id: warehouse.id,
      name: warehouse.name,
      address: warehouse.address,
      radius: String(warehouse.radius),
      openHours: { ...warehouse.openHours },
      x: warehouse.x,
      y: warehouse.y,
    });
  };

  const resetDraft = () => {
    setEditingId(null);
    setAttempted(false);
    setDraft(emptyDraft());
  };

  const submitWarehouse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    const result = validateWarehouse(draft);
    if (!result.ok) return;
    dispatch({ type: "SAVE_WAREHOUSE", draft, at });
    resetDraft();
  };

  return (
    <div className="ffl-site" id="fulfillment-top">
      <header className="ffl-header">
        <div className="ffl-brand">
          <span>CODEM DEMO / 前置仓履约</span>
          <b>即时零售履约演示</b>
        </div>
        <nav className="ffl-tabs" aria-label="履约模块视角">
          {TABS.map((entry) => (
            <button
              type="button"
              key={entry.key}
              className={tab === entry.key ? "active" : ""}
              aria-pressed={tab === entry.key}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <a className="ffl-back" href="#top">
          返回首页
        </a>
      </header>

      <div className="ffl-note">
        <span>{TABS.find((entry) => entry.key === tab)?.hint}</span>
        <small>
          演示级纯前端实现：数据仅存内存，刷新即失；时效固定 {ETA_MINUTES} 分钟，坐标为平面示意。
        </small>
      </div>

      {state.notice ? (
        <div className={`ffl-notice ffl-notice--${state.notice.kind}`} role="status">
          <span>{state.notice.text}</span>
          <button type="button" onClick={() => dispatch({ type: "DISMISS_NOTICE" })}>
            知道了
          </button>
        </div>
      ) : null}

      <main className="ffl-body">
        {tab === "ops" ? (
          <section className="ffl-panel">
            <article className="ffl-card">
              <h2>前置仓列表</h2>
              <table className="ffl-table">
                <thead>
                  <tr>
                    <th>仓名称</th>
                    <th>服务地址</th>
                    <th>半径</th>
                    <th>营业时间</th>
                    <th>营业状态</th>
                    <th>库存</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.warehouses.map((warehouse) => (
                    <tr key={warehouse.id}>
                      <td>
                        <b>{warehouse.name}</b>
                        <small>{warehouse.id}</small>
                      </td>
                      <td>
                        {warehouse.address}
                        <small>
                          坐标 ({warehouse.x}, {warehouse.y})
                        </small>
                      </td>
                      <td>{warehouse.radius} 单位</td>
                      <td>
                        {warehouse.openHours.start} - {warehouse.openHours.end}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`ffl-toggle ${warehouse.isOpen ? "on" : "off"}`}
                          onClick={() => dispatch({ type: "TOGGLE_WAREHOUSE", id: warehouse.id })}
                        >
                          {warehouse.isOpen ? "营业中" : "已闭店"}
                        </button>
                      </td>
                      <td>
                        {warehouse.stock.map((item) => (
                          <small key={item.sku} className="ffl-stock-line">
                            {item.name}：{item.stock}
                          </small>
                        ))}
                      </td>
                      <td>
                        <button type="button" className="ffl-link" onClick={() => startEdit(warehouse)}>
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="ffl-card">
              <h2>{editingId ? "编辑前置仓" : "新增前置仓"}</h2>
              <form className="ffl-form" onSubmit={submitWarehouse} noValidate>
                <label>
                  <span>仓名称 *</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="例如 长宁前置仓"
                  />
                  {attempted && draftErrors.name ? <em>{draftErrors.name}</em> : null}
                </label>
                <label>
                  <span>服务地址 *</span>
                  <input
                    value={draft.address}
                    onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                    placeholder="例如 长宁区仙霞路 99 号"
                  />
                  {attempted && draftErrors.address ? <em>{draftErrors.address}</em> : null}
                </label>
                <div className="ffl-form-row">
                  <label>
                    <span>服务半径（单位）*</span>
                    <input
                      value={String(draft.radius)}
                      onChange={(event) => setDraft({ ...draft, radius: event.target.value })}
                      placeholder="例如 5"
                    />
                    {attempted && draftErrors.radius ? <em>{draftErrors.radius}</em> : null}
                  </label>
                  <label>
                    <span>坐标 X</span>
                    <input
                      value={String(draft.x ?? 0)}
                      onChange={(event) => setDraft({ ...draft, x: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    <span>坐标 Y</span>
                    <input
                      value={String(draft.y ?? 0)}
                      onChange={(event) => setDraft({ ...draft, y: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
                <div className="ffl-form-row">
                  <label>
                    <span>营业开始 *</span>
                    <input
                      value={draft.openHours.start}
                      onChange={(event) =>
                        setDraft({ ...draft, openHours: { ...draft.openHours, start: event.target.value } })
                      }
                      placeholder="07:00"
                    />
                  </label>
                  <label>
                    <span>营业结束 *</span>
                    <input
                      value={draft.openHours.end}
                      onChange={(event) =>
                        setDraft({ ...draft, openHours: { ...draft.openHours, end: event.target.value } })
                      }
                      placeholder="22:00"
                    />
                  </label>
                </div>
                {attempted && draftErrors.openHours ? <em className="ffl-form-error">{draftErrors.openHours}</em> : null}
                <div className="ffl-form-actions">
                  <button type="submit" className="ffl-primary">
                    {editingId ? "保存修改" : "创建前置仓"}
                  </button>
                  {editingId ? (
                    <button type="button" className="ffl-secondary" onClick={resetDraft}>
                      取消编辑
                    </button>
                  ) : null}
                </div>
              </form>
            </article>
          </section>
        ) : null}

        {tab === "consumer" ? (
          <section className="ffl-panel ffl-panel--split">
            <article className="ffl-card">
              <h2>选择收货地址</h2>
              <div className="ffl-address-list">
                {PRESET_ADDRESSES.map((preset) => (
                  <button
                    type="button"
                    key={preset.label}
                    className={addressLabel === preset.label ? "active" : ""}
                    onClick={() => selectAddress(preset.label)}
                  >
                    <span>{preset.label}</span>
                    <small>
                      坐标 ({preset.x}, {preset.y})
                    </small>
                  </button>
                ))}
              </div>

              <h2>商品清单</h2>
              <ul className="ffl-catalog">
                {DEMO_CATALOG.map((item) => (
                  <li key={item.sku}>
                    <div>
                      <b>{item.name}</b>
                      <small>{money(item.price)}</small>
                    </div>
                    <div className="ffl-qty">
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "SET_CART_QTY", sku: item.sku, qty: (state.cart[item.sku] ?? 0) - 1 })}
                        aria-label={`减少 ${item.name}`}
                      >
                        −
                      </button>
                      <span>{state.cart[item.sku] ?? 0}</span>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "ADD_TO_CART", sku: item.sku })}
                        aria-label={`增加 ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="ffl-cart-bar">
                <span>
                  共 {cartCount} 件 · 合计 {money(cartAmount)}
                </span>
                <button type="button" className="ffl-primary" onClick={submitOrder} disabled={cartCount === 0}>
                  提交下单
                </button>
              </div>
              <small className="ffl-hint">提交后系统按地址就近分配前置仓并锁定库存；范围外、闭店或库存不足会直接拦截并提示原因。</small>
            </article>

            <article className="ffl-card">
              <h2>我的订单（全程状态可查）</h2>
              {state.orders.length === 0 ? <p className="ffl-empty">还没有订单，先在左侧选择地址和商品下单。</p> : null}
              <div className="ffl-orders">
                {state.orders.map((order) => (
                  <article key={order.id} className="ffl-order">
                    <header>
                      <div>
                        <b>{order.id}</b>
                        <StatusPill order={order} />
                      </div>
                      {order.status === "PAID_WAIT_PICK" ? (
                        <button type="button" className="ffl-link danger" onClick={() => dispatch({ type: "CANCEL_ORDER", orderId: order.id, at })}>
                          取消订单
                        </button>
                      ) : (
                        <small className="ffl-cancel-hint">当前阶段不可取消</small>
                      )}
                    </header>
                    <OrderSummary order={order} />
                    <OrderLines order={order} />
                    {order.cancelReason ? <p className="ffl-reason">取消原因：{order.cancelReason}</p> : null}
                    <OrderTimeline order={order} />
                  </article>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {tab === "warehouse" ? (
          <section className="ffl-panel">
            <article className="ffl-card">
              <h2>拣货任务清单</h2>
              <div className="ffl-filter">
                <span>按前置仓过滤：</span>
                <select value={activeWarehouseId} onChange={(event) => setActiveWarehouseId(event.target.value)}>
                  {state.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>
              {pickTasks.length === 0 ? <p className="ffl-empty">当前前置仓没有待拣货任务。到「消费者」视角下一单试试。</p> : null}
              <div className="ffl-orders">
                {pickTasks.map((order) => (
                  <article key={order.id} className="ffl-order">
                    <header>
                      <div>
                        <b>{order.id}</b>
                        <StatusPill order={order} />
                      </div>
                      <div className="ffl-actions">
                        {order.status === "PAID_WAIT_PICK" ? (
                          <button
                            type="button"
                            className="ffl-primary"
                            onClick={() => dispatch({ type: "ORDER_ACTION", orderId: order.id, action: "START_PICK", at })}
                          >
                            开始拣货
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ffl-primary"
                              onClick={() => dispatch({ type: "ORDER_ACTION", orderId: order.id, action: "FINISH_PICK", at })}
                            >
                              完成拣货打包
                            </button>
                            <button
                              type="button"
                              className="ffl-secondary"
                              onClick={() => dispatch({ type: "ORDER_ACTION", orderId: order.id, action: "REPORT_OUT_OF_STOCK", at })}
                            >
                              上报缺货
                            </button>
                          </>
                        )}
                      </div>
                    </header>
                    <OrderSummary order={order} />
                    <ul className="ffl-checklist">
                      {order.items.map((item) => (
                        <li key={item.sku}>
                          <b>{item.name}</b>
                          <small>
                            应拣 {item.qty} · 仓位 {item.sku}
                          </small>
                        </li>
                      ))}
                    </ul>
                    <OrderTimeline order={order} />
                  </article>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {tab === "courier" ? (
          <section className="ffl-panel">
            <article className="ffl-card">
              <h2>待配送 / 配送中</h2>
              <div className="ffl-filter">
                <span>按前置仓过滤：</span>
                <select value={courierWarehouseId} onChange={(event) => setCourierWarehouseId(event.target.value)}>
                  <option value="ALL">全部</option>
                  {state.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>
              {courierOrders.length === 0 ? <p className="ffl-empty">没有待配送订单。仓内完成打包后订单会出现在这里。</p> : null}
              <div className="ffl-orders">
                {courierOrders.map((order) => {
                  const timedOut = isDeliveryTimeout(order, now);
                  return (
                    <article key={order.id} className="ffl-order">
                      <header>
                        <div>
                          <b>{order.id}</b>
                          <StatusPill order={order} />
                          {timedOut ? <span className="ffl-badge danger">配送超时</span> : null}
                        </div>
                        <div className="ffl-actions">
                          {order.status === "WAIT_DELIVERY" ? (
                            <button
                              type="button"
                              className="ffl-primary"
                              onClick={() => dispatch({ type: "ORDER_ACTION", orderId: order.id, action: "ACCEPT_DELIVERY", at })}
                            >
                              接单配送
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="ffl-primary"
                                onClick={() => dispatch({ type: "ORDER_ACTION", orderId: order.id, action: "CONFIRM_DELIVERED", at })}
                              >
                                确认送达
                              </button>
                              {timedOut ? (
                                <button
                                  type="button"
                                  className="ffl-secondary"
                                  onClick={() => dispatch({ type: "ORDER_ACTION", orderId: order.id, action: "REDISPATCH", at })}
                                >
                                  重新配送
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </header>
                      <OrderSummary order={order} />
                      <OrderLines order={order} />
                      <OrderTimeline order={order} />
                    </article>
                  );
                })}
              </div>
            </article>
          </section>
        ) : null}
      </main>
    </div>
  );
}
