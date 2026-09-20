import assert from "node:assert";
import {
  buildSeries,
  canEdit,
  canReturn,
  isTransferReady,
  performBatchTransfer,
  performReturn,
  sampleBlockers,
  tempProblems,
} from "../node_modules/.cache/rules.mjs";

const A = "管理员";
const B = "接收人";

function base(over = {}) {
  return {
    id: "X-1",
    batchNo: "B1",
    caseId: "C1",
    location: "地点",
    exposureStage: "新鲜期",
    species: "蝇",
    devStage: "幼虫",
    sampledAt: "2026-09-10T08:00",
    preservation: "75% 乙醇浸泡",
    note: "",
    temps: buildSeries("2026-09-10T08:00", [26, 27, 28, 27, 25, 23]),
    status: "held",
    owner: A,
    originalOwner: A,
    review: false,
    events: [],
    ...over,
  };
}

// 1. 完整样本满足交接条件
const ok = base();
assert.ok(isTransferReady(ok, A), "完整样本应可交接");
assert.deepStrictEqual(sampleBlockers(ok, A), []);

// 2. 保存方式缺失 / 未关联案件 → 阻止
assert.ok(!isTransferReady(base({ preservation: "" }), A));
assert.ok(!isTransferReady(base({ caseId: null }), A));

// 3. 温度曲线缺档（跳过一个 6h 点 → 12h 间隔）→ 阻止
const gap = base({
  temps: buildSeries("2026-09-10T08:00", [26, 27, 28, 27, 25, 23], [3]),
});
assert.ok(tempProblems(gap).some((p) => p.includes("缺档")));
assert.ok(!isTransferReady(gap, A));

// 4. 成功交接：原保管人失去编辑权，接收人取得
const draft = { receiver: B, place: "物证中心", time: "2026-09-15T10:00" };
let r = performBatchTransfer([ok], [ok.id], draft, A);
assert.ok(r.ok);
const transferred = r.samples[0];
assert.strictEqual(transferred.status, "transferred");
assert.strictEqual(transferred.owner, B);
assert.ok(!canEdit(transferred, A), "原保管人应失去编辑权");
assert.ok(canEdit(transferred, B), "接收人应取得编辑权");
assert.ok(canReturn(transferred, B));

// 5. 批量中任一不合格 → 整批保持原状态（返回原数组引用，无任何变更）
const good = base({ id: "G", batchNo: "BB" });
const bad = base({ id: "BAD", batchNo: "BB", caseId: null });
const before = [good, bad];
const rb = performBatchTransfer(before, ["G", "BAD"], draft, A);
assert.ok(!rb.ok, "批量应失败");
assert.strictEqual(rb.samples, undefined);
assert.strictEqual(before[0].status, "held", "整批保持原状态");
assert.strictEqual(before[1].status, "held");
assert.ok(rb.failures.some((f) => f.id === "BAD"));

// 6. 接收人、地点、时间缺一不可
assert.ok(!performBatchTransfer([ok], [ok.id], { ...draft, receiver: "" }, A).ok);
assert.ok(!performBatchTransfer([ok], [ok.id], { ...draft, place: "" }, A).ok);
assert.ok(!performBatchTransfer([ok], [ok.id], { ...draft, time: "" }, A).ok);

// 7. 非保管人不能发起交接
assert.ok(!isTransferReady(ok, "外人"));

// 8. 退回：归原保管人 + 待复核 + 不能再次转交
const rr = performReturn([transferred], transferred.id, B, "物证中心", "2026-09-16T09:00");
assert.ok(rr.ok);
const returned = rr.samples[0];
assert.strictEqual(returned.status, "review");
assert.strictEqual(returned.owner, A, "应归还原保管人");
assert.ok(returned.review, "应标记待复核");
assert.ok(canEdit(returned, A), "原保管人恢复编辑权");
assert.ok(
  sampleBlockers(returned, A).some((i) => i.code === "status"),
  "待复核样本应被阻止再次转交"
);
assert.ok(!isTransferReady(returned, A));
assert.ok(!canReturn(returned, B), "已退回不能重复退回");

// 9. 非接收人不能退回
assert.ok(!performReturn([transferred], transferred.id, A, "x", "2026-09-16T09:00").ok);

// 10. 全部合格的批量原子交接成功，事件链完整
const g1 = base({ id: "G1", batchNo: "B9" });
const g2 = base({ id: "G2", batchNo: "B9" });
const r2 = performBatchTransfer([g1, g2], ["G1", "G2"], draft, A);
assert.ok(r2.ok);
assert.ok(r2.samples.every((s) => s.owner === B));
assert.strictEqual(r2.samples[0].events.at(-1).kind, "transfer");

console.log("全部 10 组业务规则断言通过 ✓");
