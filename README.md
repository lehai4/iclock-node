# iclock-node

Bản Node.js thay thế cho bộ PHP `iclock/` hiện tại — tiếp nhận dữ liệu từ máy chấm công ZKTeco qua giao thức iClock Push SDK. Cùng mục đích và hành vi với 3 endpoint đang hoạt động (`cdata.php`, `getrequest.php`, `devicecmd.php`); `_getrequest.php` (đồng bộ giờ + yêu cầu máy bù dữ liệu) vẫn ở dạng chưa gắn route, y như bản gốc.

## Cài đặt

```bash
npm install
cp .env.example .env
# sửa lại .env: DB_SERVER, DB_NAME, DB_USER, DB_PASS, PORT...
npm start
```

## Endpoint

| Route | Tương đương | Chức năng |
|---|---|---|
| `/iclock/cdata` | `cdata.php` | Nhận `table=ATTLOG` (POST, text/plain tab-separated) → insert vào `HRM_AttendanceLog`, bỏ qua bản ghi trùng (unique violation). |
| `/iclock/getrequest` | `getrequest.php` | Máy poll định kỳ hỏi lệnh; gửi xuống lệnh đồng bộ giờ (định kỳ, xem mục bên dưới) và/hoặc lệnh bù dữ liệu đang chờ (xem mục Backfill), không có gì thì trả `OK`. Có chỉnh lùi header `Date` 1 tiếng. |
| `/iclock/devicecmd` | `devicecmd.php` | Máy báo kết quả (ACK) sau khi chạy lệnh; ghi log vào `logs/devicecmd_log.txt`. |
| `POST /admin/backfill` | — (mới) | Người dùng gọi tay để yêu cầu máy tải bù dữ liệu ATTLOG cũ. Xem mục bên dưới. |
| `GET /admin/backfill/pending` | — (mới) | Xem hàng đợi lệnh hiện tại (debug). |

`routes/_getrequest.js` (bản cũ, tương đương `_getrequest.php` gốc) vẫn còn trong repo để tham khảo nhưng **không** được mount — logic bù dữ liệu ở đó bị hard-code chạy mỗi lần máy poll (rất dở, dễ spam lệnh liên tục). Bản chính thức để dùng là cơ chế backfill theo yêu cầu mô tả ngay dưới đây.

## Bù dữ liệu cũ (backfill)

Khi máy chấm công đang có sẵn dữ liệu quẹt thẻ mà server chưa từng nhận (server bị tắt một thời gian, mới cài lại...), có thể yêu cầu máy tự gửi lại toàn bộ log trong một khoảng thời gian. Luồng hoạt động:

1. Gọi `POST /admin/backfill?SN=<serial máy>&start=YYYY-MM-DD%20HH:mm:ss&end=YYYY-MM-DD%20HH:mm:ss` (tham số truyền qua query string, `%20` là dấu cách được encode).
2. Lệnh `C:id:DATA QUERY ATTLOG StartTime=...\tEndTime=...` được xếp vào hàng đợi trong bộ nhớ (`commandQueue.js`), theo đúng SN.
3. Lần `/iclock/getrequest` **kế tiếp** của đúng máy đó (thường trong vài chục giây, tuỳ chu kỳ poll) sẽ nhận được lệnh này, log lại vào `logs/sent_commands_log.txt`, và bị xoá khỏi hàng đợi (không gửi lặp lại).
4. Máy tự truy vấn log nội bộ trong khoảng `start`–`end` rồi POST lên `/iclock/cdata?table=ATTLOG` như chấm công bình thường — theo dõi kết quả ở `logs/attendance_log.txt` (`nhan=... moi=... trung=...`).

Ví dụ:

```bash
curl -X POST "http://may-chu:PORT/admin/backfill?SN=2017173760763&start=2026-08-01%2000:00:00&end=2026-08-26%2023:59:59"
```

Lưu ý: hàng đợi lệnh nằm trong bộ nhớ (RAM) của tiến trình Node — **mất hết nếu restart server** trước khi máy kịp poll. Nếu vậy chỉ cần gọi lại `/admin/backfill` một lần nữa là được, không cần thao tác gì trên máy chấm công.

## Tự động bù dữ liệu gần đây (không cần bấm tay)

Ngoài backfill thủ công (khoảng thời gian tuỳ chỉnh, gọi tay) ở trên, `getrequest.js` còn tự động gửi lệnh `DATA QUERY ATTLOG` cho **N ngày gần nhất** theo định kỳ, để tự "vét" lại dữ liệu nếu server bị mất kết nối/tắt một lúc mà không cần ai phải nhớ gọi API. Dữ liệu trùng vẫn được chặn an toàn bởi unique constraint như bình thường (xem `logs/attendance_log.txt`, cột `trung`).

Cấu hình qua `.env`:

- `AUTO_BACKFILL_ENABLED=true` — bật/tắt tính năng này.
- `AUTO_BACKFILL_DAYS=30` — số ngày gần nhất sẽ yêu cầu máy gửi lại mỗi lần tự động bù.
- `AUTO_BACKFILL_INTERVAL_MINUTES=1440` (mặc định 1 ngày/lần) — **không nên đặt quá ngắn**. Mỗi lần lệnh này được gửi, máy phải đọc lại toàn bộ log nội bộ trong `AUTO_BACKFILL_DAYS` ngày và đẩy hết lên server — công ty đông người có thể là hàng chục nghìn dòng. Dù không tạo dữ liệu trùng nhưng vẫn tốn băng thông, CPU máy chấm công, và hàng loạt lượt INSERT-thất-bại trên SQL Server nếu lặp lại quá thường xuyên. 1 lần/ngày là mức an toàn — kết hợp với việc **lần poll đầu tiên sau mỗi lần restart server luôn được bù ngay lập tức** (không đợi cooldown, vì bộ đếm nằm trong RAM), nên trường hợp server bị down rồi bật lại vẫn được xử lý ngay mà không cần tăng tần suất.

## Đồng bộ giờ tự động

Máy chấm công này từng bị lệch giờ (quan sát được ~1 tiếng ở lần kiểm tra trước). `getrequest.js` giờ chủ động gửi lệnh `SET OPTIONS DateTime=...` (đúng giờ Việt Nam) xuống máy — lệnh này đã test và được máy ACK `Return=0` (thành công), xem `logs/devicecmd_log.txt`.

Cấu hình qua `.env`:

- `TIME_SYNC_ENABLED=true` — bật/tắt tính năng này.
- `TIME_SYNC_INTERVAL_MINUTES=10` — chỉ gửi lại lệnh đồng bộ mỗi X phút cho **mỗi máy** (tính riêng theo SN), tránh gửi dồn dập mỗi lần máy poll (vài giây/lần).
- `DEVICE_TIME_OFFSET_MINUTES=0` — bù thêm/bớt số phút này trước khi gửi giờ xuống máy. Một số máy có firmware quirk: sau khi nhận đúng giờ thật lại tự chạy lệch đi vài chục phút/tiếng — nếu gặp tình huống này, thử chỉnh số âm/dương rồi so sánh giờ hiển thị trên máy thực tế để tinh chỉnh dần (không có giá trị chuẩn chung, tuỳ máy).

Trạng thái "lần đồng bộ gần nhất" của từng SN nằm trong bộ nhớ, mất khi restart server — sau khi restart, lần poll đầu tiên của mỗi máy sẽ luôn được đồng bộ lại ngay (không sao, không phải lỗi).

## Log — cách biết máy có chấm công thật vào DB hay không

Mọi log ghi ra thư mục `logs/` (đổi vị trí bằng biến `LOG_DIR` trong `.env`, tắt hẳn bằng `LOG_TO_FILE=false`):

| File | Ghi khi nào | Dùng để làm gì |
|---|---|---|
| `logs/request_debug_log.txt` | **Mọi** request thật sự tới server (mọi route, mọi method) | Biết máy chấm công có gọi đúng URL không, body gửi lên là gì (`body_len`, `body_preview`). Nếu bấm chấm công mà không thấy dòng nào mới xuất hiện ở đây → máy không hề gọi tới server này (sai địa chỉ/cổng, server không chạy, tường lửa chặn...), chưa liên quan gì tới DB cả. |
| `logs/attendance_log.txt` | Mỗi lần `cdata` nhận `table=ATTLOG` có dữ liệu | Tóm tắt `nhan=N moi=S trung=D loi=E` — `nhan` là số dòng hợp lệ nhận được, `moi` là số dòng thật sự insert thành công vào `HRM_AttendanceLog`. Nếu dòng ghi `KHONG KET NOI DUOC SQL SERVER` thì tức là request có tới nơi nhưng DB đang không kết nối được (xem thêm ở console/`npm start`). |
| `logs/devicecmd_log.txt` | Mỗi lần máy báo ACK kết quả lệnh | Biết lệnh gửi xuống máy (vd đồng bộ giờ) có chạy thành công không (`Return=0` là OK). |

Cách debug nhanh khi nghi ngờ "chấm công không vào DB": mở 2 terminal, một chạy `npm start`, một `tail -f logs/request_debug_log.txt` (Windows PowerShell: `Get-Content logs\request_debug_log.txt -Wait -Tail 20`), rồi thọt tay vào máy chấm công thật. Nếu **không** thấy dòng `POST /iclock/cdata?...table=ATTLOG...` xuất hiện trong vài giây → vấn đề nằm ở kết nối mạng/địa chỉ server chứ không phải ở code. Nếu có dòng đó nhưng `logs/attendance_log.txt` báo `moi=0 loi=0 trung=0` → có thể body rỗng hoặc dữ liệu không đúng định dạng (xem `body_preview` ở request_debug_log để đối chiếu). Nếu báo `KHONG KET NOI DUOC SQL SERVER` → kiểm tra lại `.env` (`DB_SERVER`, `DB_USER`, `DB_PASS`) và SQL Server có đang chạy/cho phép kết nối từ máy này không.

**Lưu ý quan trọng đã sửa**: máy chấm công gửi POST **không kèm header `Content-Type`**. Nếu body-parser của Express dùng `type: '*/*'` thì sẽ *bỏ qua không đọc body* trong trường hợp này (Express yêu cầu phải có Content-Type để so khớp wildcard `*/*`), khiến `cdata` luôn thấy body rỗng dù máy gửi dữ liệu thật. `server.js` ở đây đã dùng `type: () => true` để ép đọc raw body bất kể có Content-Type hay không — đã test xác nhận hoạt động đúng.

## Ghi chú khác

- Cần tạo bảng `HRM_AttendanceLog` sẵn trên SQL Server (không có trong repo gốc, server chỉ insert vào bảng có sẵn).
- Thông tin kết nối DB nên đặt qua `.env` (không hardcode như `db.php` gốc) — nhớ đừng commit file `.env` thật.
- Muốn dùng lại reverse-proxy/route như `.htaccess` (ví dụ chạy sau Nginx/IIS) thì trỏ `/iclock/*` về server Node này (mặc định cổng lấy từ biến `PORT`).

## Tự động dọn dữ liệu (ngày 15 hàng tháng)

Vào ngày `MONTHLY_CLEANUP_DAY` hàng tháng (mặc định 15, đổi qua `.env`), server tự động xóa dữ liệu của **tháng trước tháng trước liền kề** (lùi 2 tháng so với hiện tại), **không phải tháng trước liền kề**. Ví dụ hôm nay 15/08/2026: tháng 7 (tháng trước liền kề) được **giữ nguyên**, chỉ tháng 6 bị xóa — lý do: bộ phận nhân sự có thể còn cần dữ liệu tháng trước liền kề để chốt công ngay cả sau ngày 15 (chốt trễ).

Cụ thể server tự động:

1. Xuất toàn bộ `HRM_AttendanceLog` của **tháng trước** ra file CSV trong `MONTHLY_CLEANUP_BACKUP_DIR` (mặc định `./backups/HRM_AttendanceLog_YYYY-MM.csv`).
2. `DELETE` các dòng đó khỏi SQL Server.

3. Xếp lệnh `DATA DELETE ATTLOG StartTime=...\tEndTime=...` cho **mọi máy chấm công đã từng kết nối** (danh sách SN tự ghi nhận vào `known_devices.json`) — lệnh này được gửi ở lần `/iclock/getrequest` kế tiếp của từng máy.

**Đã bật lại bước 3** sau khi test thủ công qua `/admin/cleanup/test-device-command` và xác nhận User/FP/Face/Card Count trên máy không đổi (chỉ Att Log Count giảm đúng phạm vi). Nếu sau này thấy dấu hiệu bất thường (mất vân tay/người dùng), quay lại comment đoạn `queueDeviceDeleteCommand` trong `monthlyCleanup.js` để tắt bước này ngay.

Toàn bộ quá trình ghi log vào `logs/cleanup_log.txt`.

**Muốn tự tay test lệnh xóa trên máy (không tự động)**, vẫn dùng được route dưới đây bất cứ lúc nào — **bắt buộc phải ghi lại User Count / FP Count / Face Count / Card Count trên màn hình máy TRƯỚC và SAU khi gọi**, chỉ Att Log Count được phép đổi:

**Trước khi tin tưởng chạy tự động, hãy test riêng lệnh xóa trên máy** (không đụng gì tới DB):

```bash
curl -X POST "http://may-chu:PORT/admin/cleanup/test-device-command?SN=<serial>&month=2026-07"
```

Đợi máy poll xong (vài chục giây), xem `logs/devicecmd_log.txt` để biết máy trả `Return=0` (thành công) hay lỗi/không hiểu lệnh — đối chiếu thêm với số lượng bản ghi hiển thị trên màn hình máy để chắc chắn.

Muốn chạy thử toàn bộ (backup + xóa DB thật + xếp lệnh cho máy) ngay lập tức thay vì đợi ngày 15:

```bash
curl -X POST "http://may-chu:PORT/admin/cleanup/run?confirm=yes&month=2026-07"
```

Các endpoint hỗ trợ khác:

| Route | Chức năng |
|---|---|
| `GET /admin/cleanup/known-devices` | Xem danh sách SN máy đã từng kết nối |
| `GET /admin/cleanup/status` | Xem tháng đã dọn gần nhất |

**Lưu ý khi mới bật tính năng này**: nếu hôm nay đã qua ngày `MONTHLY_CLEANUP_DAY` của tháng hiện tại, server sẽ chạy dọn dẹp **ngay khi khởi động** (không đợi đến ngày 15 lần sau) cho tháng trước đó, vì `cleanup_state.json` chưa ghi nhận đã chạy. Nếu muốn kiểm tra lệnh xóa trên máy trước, hãy đặt tạm `MONTHLY_CLEANUP_ENABLED=false` trong `.env`, khởi động server, gọi `/admin/cleanup/test-device-command` để test, rồi mới đặt lại `true` và khởi động lại.
