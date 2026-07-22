import { formatMoney } from "../render/output.js";
import { writeCommandEnvelope } from "./guidance.js";
export async function runOrder(backend, orderID, options = {}) {
    const order = await backend.getOrder(orderID);
    const [delivery, refundResponse] = await Promise.all([
        order.status === "delivered" ? backend.getOrderDeliveryAccess(orderID) : Promise.resolve(undefined),
        backend.listOrderRefunds(orderID),
    ]);
    const lockedRefund = refundResponse.refunds.find((refund) => refund.access_locked);
    const envelope = orderEnvelope(order, delivery, lockedRefund);
    writeCommandEnvelope(envelope, {
        ...(options.jsonOutput !== undefined ? { jsonOutput: options.jsonOutput } : {}),
        ...(options.output ? { output: options.output } : {}),
        plainResult: orderPlainResult(envelope.result),
    });
}
function orderEnvelope(order, delivery, lockedRefund) {
    const refundTerminal = lockedRefund && ["succeeded", "failed", "cancelled", "rejected"].includes(lockedRefund.status);
    let instruction = "订单状态已读取；当前没有可用交付入口。";
    let next = null;
    if (lockedRefund) {
        instruction = "退款访问锁已生效；不要 reveal、创建 grant 或读取交付结果。";
        if (!refundTerminal) {
            next = { command: `itpay refund get ${lockedRefund.refund_request_id} --json`, reason: "读取退款的服务器状态" };
        }
    }
    else if (delivery?.service_execution_id) {
        instruction = "根据 delivery_mode 使用对应读取入口；不要从订单摘要猜测受保护内容。";
        next = { command: `itpay services next ${delivery.service_execution_id} --json`, reason: "读取交付状态" };
    }
    else if (!["delivered", "refunded", "failed", "cancelled"].includes(order.status)) {
        instruction = "订单尚未进入交付终态；稍后查询同一订单，不要创建替代订单。";
        next = { command: `itpay order ${order.order_id} --json`, reason: "刷新订单状态" };
    }
    return {
        status: order.status,
        result: {
            order_id: order.order_id,
            ...(order.order_code ? { order_code: order.order_code } : {}),
            amount: formatMoney(order.amount_minor, order.currency),
            ...(delivery ? { delivery_mode: delivery.delivery_mode } : {}),
            access_locked: Boolean(lockedRefund),
            ...(delivery?.service_execution_id ? { service_execution_id: delivery.service_execution_id } : {}),
            ...(lockedRefund ? { refund: { refund_request_id: lockedRefund.refund_request_id, status: lockedRefund.status } } : {}),
        },
        instruction,
        next,
        recovery: [],
    };
}
function orderPlainResult(result) {
    return Object.entries(result).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}
