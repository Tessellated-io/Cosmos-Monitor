const PagerDuty = require('node-pagerduty');
import * as WebRequest from 'web-request'

// Pager Duty
const PAGER_DUTY_API_KEY = ""
const PAGER_DUTY_SERVICE = ""
const PAGER_DUTY_EMAIL = ""

// RPC URLs
const remoteAPI = "https://api.cosmos.network/blocks/latest"
const localAPI = "http://127.0.0.1:1317/blocks/latest"

// HEADERS
const HEADERS = { "headers": { "Content-Type": "application/json" } };

// Amount to be behind.
const ACCEPTABLE_LAG = 5

// Amount to allow the remote to be behind before paging
const ACCEPTABLE_REMOTE_LAG = -5000

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

      console.log("> Fetching Remote API Information")
      const remoteResult = await WebRequest.get(remoteAPI, HEADERS)
      if (remoteResult.statusCode !== 200) {
        await page("Remote API is down", `${remoteResult.statusCode}: ${remoteResult.content}`, 5 * 60, `${remoteResult.statusCode}`)
      }
      console.log("> Done Remote Fetch")

      const localData = JSON.parse(localResult.content)
      const remoteData = JSON.parse(remoteResult.content)

      // Make sure we're relatively close
      const localHeight = parseInt(localData.block.header.height)
      const remoteHeight = parseInt(remoteData.block.header.height)
      console.log('> Local Height: ' + localHeight)
      console.log('> Remote Height: ' + remoteHeight)

      const lag = remoteHeight - localHeight
      if (lag !== 0) { console.log('> Lag: ' + lag) }

      if (lag > ACCEPTABLE_LAG) {
        await page("Node is lagging", "Local: " + localHeight + ", Remote: " + remoteHeight, 5 * 60, "lag")
      }

      if (lag < ACCEPTABLE_REMOTE_LAG) {
        await page("Remote node is lagging", "Local: " + localHeight + ", Remote: " + remoteHeight, 5 * 60, "remotelag")
      }

      let found = false
      const precommits = localData.block.last_commit.signatures
      for (let i = 0; i < precommits.length; i++) {
        const precommit = precommits[i]
        if (precommit.validatorAddress === VALIDATOR_ADDRESS) {
          found = true
        }
      }

      if (found = true) {
        consecutiveMisses = 0
      } else {
        console.log("Missed sig in block " + remoteHeight)
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
