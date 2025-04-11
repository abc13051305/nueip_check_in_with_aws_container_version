# Nueip 自動打卡小幫手 (AWS Lambda + ECR + Puppeteer)

## 專案描述

本專案旨在使用 AWS Lambda、ECR 與 Puppeteer (透過 `chrome-aws-lambda`) 自動化登入 Nueip 人事管理平台並執行「上班」或「下班」打卡操作。排程觸發透過 AWS EventBridge Scheduler 設定，執行結果（成功或失敗）將透過 Discord Webhook 發送通知。

## 主要功能

*   自動登入 Nueip 入口網站 (portal.nueip.com)。
*   根據觸發事件傳入的參數，執行「上班」或「下班」打卡。
*   檢查台灣行事曆，若是休息日則跳過打卡。
*   模擬指定的地理位置 (經緯度) 進行打卡。
*   透過 Discord Webhook 發送執行成功或失敗的通知。
*   使用 AWS Lambda 以容器映像檔 (Container Image) 方式無伺服器運行。
*   透過 AWS EventBridge Scheduler 設定 Cron 排程自動執行。

## 技術棧

*   **語言:** Node.js (JavaScript - CommonJS)
*   **瀏覽器自動化:** Puppeteer (`puppeteer-core`) + `chrome-aws-lambda`
*   **網路請求:** `node-fetch` (用於 Discord Webhook 和行事曆 API)
*   **容器化:** Docker
*   **雲端平台:** AWS
    *   **運算:** Lambda (Container Image 部署)
    *   **容器註冊表:** ECR (Elastic Container Registry)
    *   **排程:** EventBridge Scheduler
    *   **日誌:** CloudWatch Logs
*   **通知:** Discord Webhook

## 環境準備

在部署和執行此專案前，請確保你已準備好以下項目：

1.  **AWS 帳號:** 並且已設定好對應的 IAM 權限。
2.  **AWS CLI (可選):** 已安裝並設定好憑證，方便執行 AWS 指令 (或直接使用 AWS 管理主控台)。
3.  **Docker:** 已在本機安裝 Docker Desktop 或 Docker Engine。
4.  **Node.js 與 npm:** 已在本機安裝，用於管理專案依賴。
5.  **Nueip 帳號:** 公司代碼、員工編號、密碼。
6.  **Discord Webhook URL:** 用於接收通知。
7.  **打卡地點經緯度:** 需要提供 Latitude 和 Longitude。

## 設定與部署步驟

1.  **Clone 專案 (如果需要):**
    ```bash
    git clone <your-repository-url>
    cd <repository-directory>
    ```

2.  **安裝本地依賴:**
    在專案根目錄執行 `npm install`。這會根據 `package.json` 安裝必要的 Node.js 模組 (包括 `chrome-aws-lambda`, `puppeteer-core` 等)，並產生或更新 `package-lock.json`。

3.  **建立 AWS ECR 儲存庫 (Repository):**
    *   前往 AWS 管理主控台 -> ECR。
    *   建立一個新的**私有 (Private)** 儲存庫，例如命名為 `nueip-auto-punch`。記下儲存庫的 URI (格式通常是 `aws_account_id.dkr.ecr.region.amazonaws.com/repository_name`)。

4.  **建置 Docker 映像檔:**
    在專案根目錄 (包含 `Dockerfile`, `index.js`, `package.json` 的地方) 執行：
    ```bash
    docker build -t nueip-checkin:latest .
    ```
    *   `-t nueip-checkin:latest`：為映像檔設定一個本地名稱和標籤。

5.  **標記 Docker 映像檔:**
    將本地映像檔標記為符合 ECR 儲存庫 URI 的格式：
    ```bash
    docker tag nueip-checkin:latest <您的ECR儲存庫URI>:latest
    # 範例: docker tag nueip-checkin:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/nueip-auto-punch:latest
    ```
    *   請將 `<您的ECR儲存庫URI>` 替換為你在步驟 3 記下的實際 URI。

6.  **登入 AWS ECR:**
    執行 AWS CLI 命令進行認證 (或確保 Docker Desktop 已整合 AWS 登入)：
    ```bash
    aws ecr get-login-password --region <您的區域> | docker login --username AWS --password-stdin <您的AWS帳號ID>.dkr.ecr.<您的區域>.amazonaws.com
    ```
    *   替換 `<您的區域>` (例如 `us-east-1`) 和 `<您的AWS帳號ID>`。

7.  **推送 Docker 映像檔至 ECR:**
    ```bash
    docker push <您的ECR儲存庫URI>:latest
    # 範例: docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/nueip-auto-punch:latest
    ```

8.  **建立 AWS Lambda 函數:**
    *   前往 AWS 管理主控台 -> Lambda。
    *   建立一個新的函數。
    *   選擇 **"容器映像檔 (Container image)"** 選項。
    *   **函數名稱:** 自訂，例如 `nueipAutoPunchFunction`。
    *   **容器映像檔 URI:** 點擊 "瀏覽映像檔"，選擇你在 ECR 中建立的儲存庫 (`nueip-auto-punch`) 和推送的映像檔標籤 (`latest`)。
    *   **架構 (Architecture):** 選擇 `x86_64` (與基礎映像 `public.ecr.aws/lambda/nodejs:20` 預設匹配)。
    *   **執行角色 (Execution role):** 選擇或建立一個具有基本 Lambda 執行權限的角色 (需要寫入 CloudWatch Logs 的權限: `AWSLambdaBasicExecutionRole`)。如果 Lambda 需要訪問 VPC 內的資源（通常不需要），則需要額外設定 VPC 和安全組，並確保有 NAT Gateway 或 VPC Endpoint 可訪問外網。
    *   展開 **"進階設定" (Advanced settings)** (可能在 "組態" -> "一般組態" 內)：
        *   **記憶體 (Memory):** **非常重要！** 建議至少設定 **1024 MB**，推薦 **2048 MB** 或更高，以確保 Puppeteer 穩定運行。
        *   **暫時儲存 (Ephemeral storage):** 預設 512MB 通常足夠，除非有大量截圖或其他臨時檔案需求。
        *   **逾時 (Timeout):** **非常重要！** 建議至少設定 **1 分 30 秒 (90 秒)** 或更長，因為瀏覽器啟動和頁面交互需要時間。
    *   **設定環境變數 (Environment variables):** 在 "組態" -> "環境變數" 中，加入以下鍵值對：
        *   `COMPANY_CODE`: 你的 Nueip 公司代碼。
        *   `ACCOUNT`: 你的 Nueip 員工編號。
        *   `PASSWORD`: 你的 Nueip 密碼。
        *   `DISCORD_WEBHOOK`: 你的 Discord Webhook URL。
        *   `LATITUDE`: 打卡地點的緯度 (例如 `23.0083`)。
        *   `LONGITUDE`: 打卡地點的經度 (例如 `120.2205`)。
    *   **確認容器映像組態 (Container image configuration) 中的 CMD 覆寫是空的。** (我們使用 Dockerfile 內的 `CMD`)。
    *   建立函數。

9.  **設定 AWS EventBridge 排程:**
    *   前往 AWS 管理主控台 -> EventBridge。
    *   在左側選擇 "排程 (Schedules)"。
    *   建立排程 (Create schedule)。
    *   **排程名稱 (Schedule name):** 自訂，例如 `nueip-punch-in-schedule`。
    *   **(可選) 排程群組 (Schedule group):** 選擇 `default` 或建立新的。
    *   **週期性模式 (Occurrence):** 選擇 **週期性排程 (Recurring schedule)**。
    *   **排程類型 (Schedule type):** 選擇 **Cron 型運算式 (Cron-based schedule)**。
    *   **Cron 運算式:**
        *   **上班 (例如 每天早上 8:30):** `cron(30 8 * * ? *)`
        *   **下班 (例如 每天下午 5:30):** `cron(30 17 * * ? *)`
        *   **(重要) 時區 (Timezone):** 務必選擇 **Asia/Taipei**。
    *   **彈性時間範圍 (Flexible time window):** 選擇 10min 讓打卡的時間看起來自然。
    *   點擊 "下一步"。
    *   **選取目標 (Select target):** 搜尋並選擇 **AWS Lambda Invoke**。
    *   **Lambda 函數:** 選擇你剛才建立的 Lambda 函數 (`nueipAutoPunchFunction`)。
    *   **輸入/裝載 (Input/Payload):** **非常重要！** 這裡需要傳入 JSON 來指定打卡類型：
        *   **上班排程:**
          ```json
          {
            "PUNCH_TYPE": "上班"
          }
          ```
        *   **下班排程:**
          ```json
          {
            "PUNCH_TYPE": "下班"
          }
          ```
    *   點擊 "下一步"。
    *   檢查設定，例如重試政策 (Retry policy)、無效字母佇列 (Dead-letter queue) (可選)。確認狀態為 **已啟用 (Enabled)**。
    *   建立排程。
    *   **你需要為「上班」和「下班」分別建立兩個不同的 EventBridge 排程**，它們的 Cron 表達式和傳遞的 Payload 不同。

## 使用方式

設定完成後，EventBridge Scheduler 會根據你設定的 Cron 表達式自動觸發 Lambda 函數執行打卡。

你也可以在 AWS Lambda 控制台手動測試函數：

1.  進入 Lambda 函數頁面。
2.  切換到 "測試 (Test)" 標籤頁。
3.  建立一個新的測試事件。
4.  在 "事件 JSON (Event JSON)" 中輸入：
    ```json
    {
      "PUNCH_TYPE": "上班"
    }
    ```
    或
    ```json
    {
      "PUNCH_TYPE": "下班"
    }
    ```
5.  點擊 "測試 (Test)" 按鈕。執行結果和日誌會顯示在上方，同時也會發送 Discord 通知。

## 注意事項與疑難排解

*   **Nueip 介面變更:** 網站前端 (HTML 結構、CSS 選擇器、元素 ID) 的任何變更都可能導致此腳本失效。如果打卡失敗，請優先檢查登入頁面和打卡按鈕的選擇器是否仍然有效，並更新 `index.js` 中的 XPath 或 CSS 選擇器。**這是最常見的失敗原因。**
*   **ECR 成本:** 使用 `chrome-aws-lambda` 會導致容器映像檔體積較大 (接近 1GB)，可能超出 ECR 免費方案額度而產生費用。考慮使用 **Lambda Layers** 來部署 `chrome-aws-lambda` 以減小主函數映像檔體積，或設定 **ECR Lifecycle Policies** 自動清理舊映像檔。
*   **Lambda 資源:** 確保 Lambda 函數有足夠的**記憶體**和**逾時**時間。如果遇到超時或記憶體不足的錯誤，請增加配置。
*   **CloudWatch Logs:** 所有 `console.log` 和 `console.error` 的輸出，以及 Lambda 的執行錯誤，都會記錄在 CloudWatch Logs 中。這是除錯的主要工具。
*   **行事曆 API:** 專案依賴的台灣行事曆 API (`cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar`) 的穩定性無法保證。如果 API 失效，休息日判斷可能會出錯（目前會預設為工作日）。可以考慮更換為更可靠的官方 API 來源。
*   **地理位置模擬:** 雖然腳本設定了經緯度，但網站後端可能還有其他驗證機制 (如 IP 地址)，不保證一定能成功模擬位置。
*   **重複打卡:** 目前的腳本在找到按鈕後會直接點擊。如果 Nueip 系統允許重複打卡，腳本不會阻止。
