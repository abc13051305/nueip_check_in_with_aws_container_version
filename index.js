// 1. 引入依賴 - 改用 chrome-aws-lambda 和 puppeteer-core
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const fetch = require('node-fetch');

// 2. 環境變數
const {
  COMPANY_CODE,
  ACCOUNT,
  PASSWORD,
  DISCORD_WEBHOOK,
  LATITUDE,
  LONGITUDE
} = process.env;

// 3. 時間格式函數
function getNowString() {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

// 4. 取得今天日期函數
function getTodayDateString() {
  const date = new Date();
  return date.toISOString().split('T')[0];
}

// 5. 發送 Discord 通知函數
async function sendDiscordMessage(message) {
  const fullMessage = `[${getNowString()}] ${message}`;
  console.log(fullMessage);
  if (!DISCORD_WEBHOOK) {
    console.warn('⚠️ DISCORD_WEBHOOK 未設定，無法發送通知。');
    return;
  }
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fullMessage }),
    });
  } catch (error) {
    console.error('發送 Discord 通知失敗：', error);
  }
}

// 6. 檢查是否為休息日函數
async function isHoliday() {
  const today = getTodayDateString();
  const year = today.split('-')[0];
  const apiUrl = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`休息日 API 請求失敗，狀態碼：${response.status}`);
    }
    const data = await response.json();
    const todayInfo = data.find(item => item.date === today.replace(/-/g, ''));
    if (!todayInfo) {
      console.warn(`⚠️ 沒有找到 ${today} 的資料，預設為工作日`);
      return false;
    }
    return todayInfo.isHoliday === true;
  } catch (error) {
    console.error('檢查休息日失敗：', error);
    await sendDiscordMessage(`⚠️ 休息日 API 檢查失敗：${error.message}，預設繼續執行打卡流程。`);
    return false;
  }
}

// 7. Lambda handler
exports.handler = async (event) => {
  const punchType = String(event.PUNCH_TYPE || '').trim();
  if (!COMPANY_CODE || !ACCOUNT || !PASSWORD || !LATITUDE || !LONGITUDE) {
      await sendDiscordMessage('❌ 錯誤：缺少必要的環境變數 (COMPANY_CODE, ACCOUNT, PASSWORD, LATITUDE, LONGITUDE)。');
      return { statusCode: 400, body: 'Missing environment variables.' };
  }
  if (!punchType || !['上班', '下班'].includes(punchType)) {
    await sendDiscordMessage(`❌ 錯誤：傳入的 PUNCH_TYPE "${event.PUNCH_TYPE}" 不正確，必須是 "上班" 或 "下班"。`);
    return { statusCode: 400, body: 'Invalid PUNCH_TYPE.' };
  }
  await sendDiscordMessage(`🚀 開始「${punchType}」打卡流程`);
  if (await isHoliday()) {
    await sendDiscordMessage(`🛌 今天是休息日，不進行「${punchType}」打卡。`);
    return { statusCode: 200, body: 'Holiday, skipping punch.' };
  }

  let browser = null;
  let page = null;

  try {
    console.log('正在啟動瀏覽器...');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    console.log('瀏覽器啟動成功！');

    page = await browser.newPage();
    console.log('已開啟新頁面');

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

    console.log(`設定地理位置：Latitude=${LATITUDE}, Longitude=${LONGITUDE}`);
    try {
        const latitudeNum = parseFloat(LATITUDE);
        const longitudeNum = parseFloat(LONGITUDE);
        if (isNaN(latitudeNum) || isNaN(longitudeNum)) {
            throw new Error('LATITUDE 或 LONGITUDE 無法轉換為數字');
        }
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://portal.nueip.com', ['geolocation']);
        await page.setGeolocation({ latitude: latitudeNum, longitude: longitudeNum });
        console.log('地理位置設定成功');
    } catch (geoError) {
        console.error('設定地理位置失敗:', geoError);
        await sendDiscordMessage(`❌ 設定地理位置失敗: ${geoError.message}`);
        throw geoError;
    }

    console.log('導向登入頁面...');
    await page.goto('https://portal.nueip.com/login', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });
    console.log('登入頁面載入完成');

    console.log('填寫登入資訊...');
    await page.waitForSelector('input[name="inputCompany"]', { timeout: 10000 });
    await page.type('input[name="inputCompany"]', COMPANY_CODE, { delay: 50 });
    await page.waitForSelector('input[name="inputID"]', { timeout: 5000 });
    await page.type('input[name="inputID"]', ACCOUNT, { delay: 50 });
    await page.waitForSelector('input[name="inputPassword"]', { timeout: 5000 });
    await page.type('input[name="inputPassword"]', PASSWORD, { delay: 50 });
    console.log('登入資訊填寫完成');

    console.log('點擊登入按鈕...');
    await Promise.all([
      page.click('button.login-button'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
    ]);
    console.log('登入成功，已導向主頁');

    console.log('增加 10 秒初始等待...');
    await page.waitForTimeout(10000);

    const buttonXPath = `//button[.//div[@class='punch-button__title']/span[normalize-space(.)='${punchType}']]`;
    console.log(`尋找打卡按鈕 (精確 XPath): ${buttonXPath}`);

    try {
        console.log(`嘗試等待 XPath ${buttonXPath} 存在於 DOM 中，超時設為 90 秒...`);
        await page.waitForXPath(buttonXPath, {
            timeout: 90000
        });
        console.log(`XPath ${buttonXPath} 已找到於 DOM 中。`);

        const buttonElements = await page.$x(buttonXPath);

        if (buttonElements && buttonElements.length > 0) {
            const buttonElement = buttonElements[0];
            console.log(`元素 (XPath: ${buttonXPath}) 已獲取。`);
            console.log('額外等待 3 秒讓元素渲染...');
            await page.waitForTimeout(3000);

            const isVisible = await buttonElement.isIntersectingViewport();
            if (isVisible) {
                console.log(`按鈕 "${punchType}" 可見，準備點擊...`);
                await buttonElement.click();
                console.log('按鈕已點擊');
                await page.waitForTimeout(5000);
                await sendDiscordMessage(`✅ 打卡成功：「${punchType}」`);
            } else {
                console.error(`按鈕 "${punchType}" 存在但不可見！無法點擊。 XPath: ${buttonXPath}`);
                await sendDiscordMessage(`⚠️ 打卡按鈕 "${punchType}" 存在但不可見！`);
                throw new Error(`Punch button "${punchType}" found but not visible.`);
            }
        } else {
            console.error(`waitForXPath 成功但 $x 未返回元素？XPath：${buttonXPath} (異常)`);
            await sendDiscordMessage(`⚠️ 找不到「${punchType}」打卡按鈕！(XPath 異常情況)`);
            throw new Error('waitForXPath succeeded but $x returned no elements.');
        }

    } catch (waitError) {
        console.error(`等待或點擊打卡按鈕時出錯 (XPath: ${buttonXPath}):`, waitError);
        try {
            if (page) {
                const errorHtml = await page.content();
                console.log('--- 錯誤時頁面 HTML (前 2000 字元) ---');
                console.log(errorHtml.substring(0, 2000));
                console.log('--- 錯誤時頁面 HTML 結束 ---');
            } else {
                console.log("Page 對象不存在，無法獲取錯誤時的 HTML。");
            }
        } catch (debugError) {
            console.error("獲取錯誤時調試信息失敗:", debugError);
        }
        await sendDiscordMessage(`❌ 打卡失敗：${waitError.name}: ${waitError.message}`);
        throw waitError;
    }

  } catch (error) {
    console.error('打卡流程發生頂層錯誤:', error);
    if (!error.message.includes('Punch button found but not visible')) {
        await sendDiscordMessage(`❌ 打卡流程異常終止：${error.message}`);
    }
    return { statusCode: 500, body: `Punch process failed: ${error.message}` };

  } finally {
    if (browser !== null) {
      console.log('正在關閉瀏覽器...');
      await browser.close();
      console.log('瀏覽器已關閉');
    }
  }

  return { statusCode: 200, body: 'Punch process completed successfully.' };
};