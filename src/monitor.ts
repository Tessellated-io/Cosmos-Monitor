const PagerDuty = require('node-pagerduty');
import * as WebRequest from 'web-request'

// Pager Duty
const PAGER_DUTY_API_KEY = ""
const PAGER_DUTY_SERVICE = ""
const PAGER_DUTY_EMAIL = ""

// RPC URLs
const localAPI = "http://127.0.0.1:1317/blocks/latest"

// HEADERS
const HEADERS = { "headers": { "Content-Type": "application/json" } };

// Amount of seconds allowed to be out of date before paging
const ACCEPTABLE_DELTA_SECS = 20 * 60 // 20 min

// Amount to not sign
const ACCEPTABLE_CONSECUTIVE_MISS = 5

// Amount of exceptions in a row before paging.
const ACCEPTABLE_CONSECUTIVE_EXCEPTIONS = 5

// Sleep interval
const sleepInterval = 60

// My validator
const VALIDATOR_ADDRESS = "A7D9E6DB8CA5E46A61AC36235D4C8185F7BF11A4"

const pagerDutyClient = new PagerDuty(PAGER_DUTY_API_KEY);
const pagerDutyThrottle: Map<string, Date> = new Map();

let consecutiveMisses = 0
let consecutiveExceptions = 0

const monitor = async () => {
  while (true) {
    console.log("Running Health Checks")

    try {
      console.log("> Fetching Local API Information")
      const localResult = await WebRequest.get(localAPI, HEADERS)
      if (localResult.statusCode !== 200) {
        await page("Local API is down", `${localResult.statusCode}: ${localResult.content}`, 5 * 60, `${localResult.statusCode}`)
      }
      console.log("> Done Local Fetch")

      const localData = JSON.parse(localResult.content)

      // Make sure we're recent
      const blockTime = Date.parse(localData.block.header.time) / 1000
      const blockHeight = localData.block.header.height
      const currentTime = Date.now() / 1000
      const deltaTime = Math.abs(currentTime - blockTime)
      if (deltaTime > ACCEPTABLE_DELTA_SECS) {
        await page("Node is lagging", `System Time: ${currentTime}, Block Time: ${blockTime}. Is the Osmosis network stalled?`, 5 * 60, "node-lag")
      }

      let found = false
      const precommits = localData.block.last_commit.signatures
      for (let i = 0; i < precommits.length; i++) {
        const precommit = precommits[i]
        if (precommit.validator_address === VALIDATOR_ADDRESS) {
          found = true
        }
      }

      if (found == true) {
        consecutiveMisses = 0
      } else {
        console.log("Missed sig in block " + blockHeight)
        consecutiveMisses++
      }

      if (consecutiveMisses > ACCEPTABLE_CONSECUTIVE_MISS) {
        await page("Missed blocks", "Consecutive misses: " + consecutiveMisses, 5 * 60, "missed-block")
      }

      consecutiveExceptions = 0
      console.log("All good!")
      console.log(`Consecutive exceptions is now ${consecutiveExceptions}`)
    } catch (e) {
      consecutiveExceptions++
      console.log("Unknown error: " + e)
      console.log(`Consecutive exceptions is now ${consecutiveExceptions}`)

      if (consecutiveExceptions > ACCEPTABLE_CONSECUTIVE_EXCEPTIONS) {
        await page("Unknown error", e.message, 5 * 60, e.message)
      }
    }

    await sleep(sleepInterval)
  }
}

const sleep = async (seconds: number): Promise<void> => {
  const milliseconds = seconds * 1000
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}


const page = async (title, details, throttleSeconds = 60, alertKey) => {
  alertKey = alertKey || title + details

  if (shouldAlert(pagerDutyThrottle, alertKey, throttleSeconds)) {
    console.log(`Paging: ${title}`)
    const payload = {
      incident: {
        title,
        type: 'incident',
        service: {
          id: PAGER_DUTY_SERVICE,
          type: 'service_reference',
        },
        body: {
          type: 'incident_body',
          details,
        },
        incident_key: alertKey,
      },
    };

    if (pagerDutyClient != undefined) {
      await pagerDutyClient.incidents.createIncident(PAGER_DUTY_EMAIL, payload)
    }
  }
}

/** if we've already sent this exact alert in the past `x` seconds, then do not re-alert */
const shouldAlert = (throttle: Map<string, Date>, key: string, throttleSeconds: number): boolean => {
  if (!throttle.has(key)) {
    throttle.set(key, new Date());
    return true;
  }

  const now = new Date().getTime();
  const lastAlertTime = throttle.get(key)?.getTime() || 0;
  const secondsSinceAlerted = (now - lastAlertTime) / 1000;

  if (secondsSinceAlerted > throttleSeconds) {
    // We've passed our throttle delay period
    throttle.set(key, new Date());
    return true;
  }
  return false;
}

monitor()
