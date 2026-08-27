// commandQueue.js - Hang doi lenh thu cong theo SN may (vd: yeu cau backfill
// du lieu ATTLOG cu). Luu trong bo nho - du dung cho vai chuc may cham cong,
// don gian & khong can DB rieng.
//
// LUU Y: hang doi nay MAT HET khi restart server. Chi hop cho lenh "mot lan"
// nhu backfill (neu server restart giua chung, cu goi lai /admin/backfill la duoc),
// khong dung de luu trang thai quan trong lau dai.
const pendingCommands = new Map(); // sn -> string[]

function queueCommand(sn, command) {
  const list = pendingCommands.get(sn) || [];
  list.push(command);
  pendingCommands.set(sn, list);
}

// Lay het lenh dang cho cua 1 SN va xoa khoi hang doi (dung khi gui di trong getrequest)
function drainCommands(sn) {
  const list = pendingCommands.get(sn);
  if (!list || !list.length) return [];
  pendingCommands.delete(sn);
  return list;
}

// Xem toan bo hang doi hien tai (debug/admin, khong xoa)
function peekAll() {
  return Object.fromEntries(pendingCommands);
}

module.exports = { queueCommand, drainCommands, peekAll };
