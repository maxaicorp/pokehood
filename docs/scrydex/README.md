# Scrydex docs (pasted reference)

Drop the Scrydex documentation here so it can be referenced anytime instead of
guessing/probing the live API. One file per topic. Paste raw — markdown, JSON
samples, curl examples, whatever you copy.

Suggested files (create as you paste):
- `api-reference.md` — endpoints, params, auth headers, rate limits
- `cards.md` — card object shape, `include=prices`, the `prices[]` + `trends` structure
- `price-history.md` — the `/price_history` endpoint, `days` param, data depth
- `webhooks.md` — events, payload shape, HMAC-SHA256 signature verification
- `pricing.md` / `credits.md` — credit costs per endpoint
- `pop-reports.md` — population report data

## Known so far (verified live, 2026-06-06)
- Auth headers: `X-Api-Key`, `X-Team-ID` (team ID is the dashboard ID, NOT the name "Collectiblez").
- `/pokemon/v1/cards/{id}/price_history?days=N` → daily series, but only ~20 days deep (floor 2026-05-17). 1 credit/card.
- `/pokemon/v1/cards/{id}?include=prices` → `prices[].trends` has `days_1/7/14/30/90/180` % change → 6-month anchors.
- **Webhooks exist** (`<game>.expansions.prices.raw_updated` / `.graded_updated` / `.pop_reports.updated`), HMAC-SHA256 signed via `X-Scrydex-Signature` (secret `whsec_...`). Could replace the credit-burning snapshot polling with real-time push. ← design the receiver once the payload docs are pasted here.
Getting Started
Pricing Data
Overview
The Scrydex API provides extensive pricing data for trading cards, enabling users to track price trends, access historical data, and gain insights into the value of their cards.
This pricing data spans raw and graded cards, with specific details tailored to each type.

In order to include pricing data in your API responses, you must use the include query parameter in your request, with a value of prices. (e.g., ?include=prices).

[!IMPORTANT]
The prices field on cards and variants will be empty or omitted unless include=prices is explicitly specified in your request.
See game specific endpoints for more details.

Each game endpoint uses the same contracts for pricing data.

Pricing Support by Card Game
The table below outlines pricing support for both raw and graded cards across various trading card games available in the API.

Card Game	Raw Prices	Graded Prices
Pokémon	✅ Supported	✅ Supported
Lorcana	✅ Supported	✅ Supported
Magic: The Gathering	✅ Supported	⏳ Coming Soon
Gundam	✅ Supported	⏳ Coming Soon
One Piece	✅ Supported	⏳ Coming Soon
Riftbound	✅ Supported	⏳ Coming Soon
Notes:
The various API teams are actively working on expanding support for graded pricing across all card games in future updates.
General Pricing Information
Currency Correlation
Pricing data is available in multiple currencies, depending on the market of the card. This ensures the data reflects the trading practices of specific regions.

USD: Prices from US markets.
JPY: Prices from Japanese markets.
For example:

Raw prices for Japanese cards are currently all reported in JPY, reflecting the Japanese trading market.
Similarly, prices in USD reflect the value of cards in the US market.
Notes:
We are actively working on extending the markets to cover Euros as well. This will be in a future update.
Pricing Metrics
Each price record includes the following key metrics:

Low Price (low): The lowest recorded price for the card.
Market Price (market): The average market price for the card, calculated across various sources.
Currency (currency): The currency in which the price values are represented (e.g., USD, JPY).
Trends Data
The API provides detailed trend analysis, showing how card prices fluctuate over time. Trends are available for the following time periods:

1 day
7 days
14 days
30 days
90 days
180 days
Each trend includes:

Price Change (price_change): The change in price over the specified period.
Percent Change (percent_change): The percentage change relative to the starting price.
As a reminder, the price_change will always be in whatever currency the price object is set to.

Sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'
Raw
The Pokémon API provides detailed raw price data with key metrics and trends.
Raw price data corresponds to the market value of physical cards in specific conditions.
Below are the available conditions, data fields, and trends that users can query.

Conditions
All raw price data is categorized based on card condition:

NM - Near Mint
LP - Lightly Played
MP - Moderately Played
HP - Heavily Played
DM - Damaged
Price Data Structure
Each raw price record provides the following fields:

condition: The card's condition (one of the above).
is_perfect: Indicates if the card is in flawless condition (default: false) Only valid for graded cards.
is_signed: Indicates if the card is autographed (default: false) Only valid for graded cards.
is_error: Indicates if the card contains a notable error (default: false) Only valid for graded cards.
type: Always set to "raw" for raw price data.
low: The lowest known price for this card in the specific condition (currency-specific).
market: The average market price for this card condition (currency-specific).
currency: The currency of the prices, e.g., "USD".
trends: Contains historical price trends over different time periods.
Here is a sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'
Graded
The Scrydex API provides extensive pricing data for graded cards, allowing users to track their value across multiple grading standards and time periods.
This data includes support for multiple grading companies and key pricing metrics, making it a robust tool for collectors and investors.

Supported Grading Companies
The API supports pricing data for the following grading companies:

PSA (Professional Sports Authenticator)
CGC (Certified Guaranty Company)
BGS (Beckett Grading Services)
TAG, SGC, and others (when available on a card-specific basis).
This ensures broad coverage for graded cards across major validation companies.

Pricing Metrics
Graded prices include the following metrics:

Low Price (low): The lowest recorded price for the card at the specified grade.
Mid Price (mid): The median price recorded for the card.
High Price (high): The highest recorded price for the card at the specified grade.
Market Price (market): The average market price across all available data.
Currency (currency): The currency of the pricing values (e.g., USD, JPY).
Using these metrics, you can analyze card value at different pricing levels across markets.

Graded Card Details
Grading-Specific Fields
Each graded card price record includes additional fields specific to grading:

Grade (grade): The grade assigned to the card, corresponding to the grading company's standards (e.g., 10, 9.5, 9).
Grading Company (company): The name of the grading company (e.g., PSA, CGC, BGS).
Perfect Card (is_perfect): Indicates if the grade denotes a flawless card, such a CGC Pristine 10 or TAG Pristine 10 (default: false).
Signed Card (is_signed): Indicates if the card is autographed (default: false).
Error Card (is_error): Indicates if the card has notable errors or defects recognized as collectible (default: false).
Type (type): Always set to "graded" for graded price data.
Sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Here is a sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Here is a sample graded price:

{
  "grade": "10",
  "company": "PSA",
  "is_perfect": false,
  "is_signed": false,
  "is_error": false,
  "type": "graded",
  "low": 2350.0,
  "mid": 2566.0,
  "high": 2650.0,
  "market": 2567.88,
  "currency": "USD",
  "trends": {
    "days_1": {
      "price_change": 111.75,
      "percent_change": 4.55
    },
    "days_7": {
      "price_change": 111.75,
      "percent_change": 4.55
    },
    "days_14": {
      "price_change": -11.3,
      "percent_change": -0.44
    },
    "days_30": {
      "price_change": -10.93,
      "percent_change": -0.42
    },
    "days_90": {
      "price_change": -153.12,
      "percent_change": -5.63
    },
    "days_180": {
      "price_change": -1658.19,
      "percent_change": -39.24
    }
  }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Getting Started
Population Reports
Overview
Population reports (or "pop reports") provide data on the number of cards graded by various grading companies. This information is crucial for understanding the rarity and supply of specific card grades in the market.

Including Population Reports
To include population reports in your API requests, use the include query parameter. You can combine it with other include options like prices.

[!IMPORTANT]
The pop_reports field on card variants will be empty or omitted unless include=pop_reports is explicitly specified in your request.

[!NOTE]
Population reports are only available on requests that fetch cards. They are not available when fetching expansions, sets, or other resources.

Example:
include=pop_reports
include=prices,pop_reports

Availability
Population reports exist at the card variant level. It is important to note that not every variant is guaranteed to have reports.

Currently, we support the following population reports:

Support Table

TCG	Company	Language
Pokémon	PSA	English
Webhooks
Webhooks are available for receiving real-time updates when population reports are updated. You can subscribe to these events to keep your local data in sync without constant polling.

For more information on how to set up and use webhooks, check out our Webhooks Documentation.

Payload Structure
company <string>

The grading company providing the report (e.g., PSA).

total <integer>
The total number of cards graded by this company for this variant.

grade_total <integer>
The total number of cards that received a numeric grade.

qualified_grade_total <integer>
The total number of cards with qualified grades (e.g., MC, OC).

half_grade_total <integer>
The total number of cards that received a half-grade (e.g., 8.5).

grades <array>
An array of individual grade counts. Each object contains:

grade <string>: The specific grade (e.g., 10, 9, auth).
count <integer>: The number of cards that received this grade.

Sample Population Report
"pop_reports": [
  {
    "company": "PSA",
    "total": 5445,
    "grade_total": 5211,
    "qualified_grade_total": 14,
    "half_grade_total": 220,
    "grades": [
      {
        "grade": "auth",
        "count": 46
      },
      {
        "grade": "1Q",
        "count": 2
      },
      {
        "grade": "1",
        "count": 203
      },
      {
        "grade": "1.5",
        "count": 49
      },
      {
        "grade": "2Q",
        "count": 1
      },
      {
        "grade": "2",
        "count": 228
      },
      {
        "grade": "2.5",
        "count": 5
      },
      {
        "grade": "3Q",
        "count": 2
      },
      {
        "grade": "3",
        "count": 417
      },
      {
        "grade": "3.5",
        "count": 4
      },
      {
        "grade": "4Q",
        "count": 3
      },
      {
        "grade": "4",
        "count": 578
      },
      {
        "grade": "4.5",
        "count": 6
      },
      {
        "grade": "5",
        "count": 745
      },
      {
        "grade": "5.5",
        "count": 5
      },
      {
        "grade": "6Q",
        "count": 1
      },
      {
        "grade": "6",
        "count": 832
      },
      {
        "grade": "6.5",
        "count": 29
      },
      {
        "grade": "7",
        "count": 598
      },
      {
        "grade": "7.5",
        "count": 30
      },
      {
        "grade": "8",
        "count": 710
      },
      {
        "grade": "8.5",
        "count": 92
      },
      {
        "grade": "9Q",
        "count": 5
      },
      {
        "grade": "9",
        "count": 729
      },
      {
        "grade": "10",
        "count": 125
      }
    ]
  }
]
Example Request
Lang:

NODE.JS
const axios = require('axios');

const getCardWithPopReports = async (cardId) => {
  try {
    const response = await axios.get(`https://api.scrydex.com/pokemon/v1/cards/${cardId}`, {
      params: {
        include: 'pop_reports'
      },
      headers: {
        'X-Api-Key': 'YOUR_API_KEY'
      }
    });
    console.log(response.data.data.variants[0].pop_reports);
  } catch (error) {
    console.error(error);
  }
};

Getting Started
Webhooks
Overview
Webhooks allow your application to receive real-time notifications about events happening in your Scrydex account. Instead of polling the API for updates, Scrydex can push data to your specified URL via HTTP POST requests with a JSON body.

Purpose of Webhooks
Webhooks are ideal for keeping your local database in sync with Scrydex data, triggering automated workflows, or notifying your users about price changes and new card listings.

Supported Webhooks
We currently support the following webhook events:

<game>.expansions.prices.raw_updated: Triggered when a card's raw market price is updated.
<game>.expansions.prices.graded_updated: Triggered when a card's graded market price is updated.
<game>.expansions.pop_reports.updated: Triggered when population report data is updated.
Note: The <game> placeholder should be replaced with the specific TCG slug (e.g., pokemon.expansions.prices.raw_updated). Each TCG-specific documentation section will outline the exact webhook events and payload details available for that game.

Retry Policy
We understand that your services might occasionally be unavailable. If your endpoint does not return a 2xx success status code, Scrydex will retry the delivery.

We retry failed webhooks up to 4 times with exponential backoff before marking the delivery as failed.

Response Timing
Your webhook receiver should be fast to ensure reliable delivery. Ideally, your endpoint should process the event and respond in less than 1 or 2 seconds. Scrydex will time out if a response is not received within 10 seconds.

Here is a sample webhook payload:

{
  "id": "6a0375aea0b689dc8dc57fda",
  "name": "magicthegathering.expansions.prices_updated",
  "data": {
    "expansion_ids": [
      "CNS",
      "PS14",
      "PDP15",
      "PPC1",
      "PM15",
      "CP1",
      "V14",
      "DDN",
      "PKTK",
      "OC14"
    ]
  }
}
Example Request
Lang:

JAVASCRIPT
const express = require('express');
const app = express();

// Use express.raw() to get the raw body for signature verification
app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-scrydex-signature'];
  const payload = req.body; // This is a Buffer

  // Verify signature...

  console.log('Received webhook:', JSON.parse(payload));

  res.status(200).send('OK');
});

app.listen(3000, () => console.log('Server running on port 3000'));
Security
To ensure that webhook requests are authentic and haven't been tampered with, Scrydex signs every payload. We recommend that you verify these signatures before processing any event.

Scrydex webhooks use HMAC-SHA256 signatures with a shared secret (prefixed with whsec_...) sent via the X-Scrydex-Signature header.

Verifying Signatures
The X-Scrydex-Signature header contains two parts: a Unix timestamp (t) and the HMAC-SHA256 signature (v1).

Format: t=timestamp,v1=signature

1. Construct the Payload
The string to be signed is constructed by concatenating the timestamp, a dot, and the raw request body:
timestamp + "." + raw_request_body

2. The "Raw Body" Rule
Crucial: You must use the raw, unparsed byte string of the request body for signature verification. Using a re-stringified JSON object will fail because changes in spacing, key order, or encoding (Scrydex sends minified UTF-8 JSON) will result in a different signature.

Security Best Practices
Replay Protection: Verify that the timestamp t is within a 5-minute window of the current time.
Constant-time Comparison: Always use "secure compare" methods to prevent timing attacks.
Secret Handling: Treat webhook secrets like API keys. Store them in environment variables and never hardcode them.

Here is a sample webhook payload:

{
  "id": "6a0375aea0b689dc8dc57fda",
  "name": "magicthegathering.expansions.prices_updated",
  "data": {
    "expansion_ids": [
      "CNS",
      "PS14",
      "PDP15",
      "PPC1",
      "PM15",
      "CP1",
      "V14",
      "DDN",
      "PKTK",
      "OC14"
    ]
  }
}

Example Request
Lang:

JAVASCRIPT
const express = require('express');
const app = express();

// Use express.raw() to get the raw body for signature verification
app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-scrydex-signature'];
  const payload = req.body; // This is a Buffer

  // Verify signature...

  console.log('Received webhook:', JSON.parse(payload));

  res.status(200).send('OK');
});

app.listen(3000, () => console.log('Server running on port 3000'));

Pokemon
API Reference
Overview
The Pokémon API provides comprehensive data for both the English and Japanese expansions.
Every major expansion is supported, and the API continues to grow with the addition of trainer kits, promo cards, and other non-core expansions.
It allows users to scope their requests to a specific language by introducing a language code between the version and endpoint in the URL structure.
This option enables filtering the data by language, providing a localized experience.

URL Structure Examples
The default API request structure returns data without any specific language filter (will get card data in multiple languages):

https://api.scrydex.com/pokemon/v1/cards
To filter for only English cards or expansions:

https://api.scrydex.com/pokemon/v1/en/cards
https://api.scrydex.com/pokemon/v1/en/expansions
To filter for only Japanese cards or expansions:

https://api.scrydex.com/pokemon/v1/ja/cards
https://api.scrydex.com/pokemon/v1/ja/expansions
Japanese Card Data and Translations
The Japanese card data translation is still a work in progress. Not all fields are guaranteed to have translations into English, and vice versa.
Here's how the data is structured and handled when retrieving Japanese cards:

Japanese Data Representation:

Fields such as card name, attacks, abilities, etc., are primarily represented in Japanese.
English Translations:

A translation field is included, which provides the English equivalents (when available). Missing translations will result in no data for those fields.
Fallback for Missing Data:

If a Japanese card is missing a specific Japanese property (e.g., name), the corresponding field will fallback to its English equivalent.
Key Points to Note about Japanese data:
Fields such as name, supertype, subtypes, and types are in Japanese, but English equivalents are in the nested translation.en object.
If a Japanese field (e.g., name) is missing, the corresponding field will automatically contain its English value from translation.en.
Future Improvements
The Pokémon API team is actively working on:

Expanding translations for Japanese cards to English.
Ensuring English-to-Japanese translations for newly added cards.
Improving data consistency across different languages.
By using the language scoping feature, you can tailor the data retrieval process to meet your application's localization requirements seamlessly.

Here is a sample of a Japanese card:

{
  "id": "sv10_ja-1",
  "name": "クヌギダマ",
  "supertype": "ポケモン",
  "subtypes": [
    "たね"
  ],
  "types": [
    "草"
  ],
  "hp": "70",
  "attacks": [
    {
      "cost": [
        "無"
      ],
      "converted_energy_cost": 1,
      "name": "ぶらさがる",
      "text": "",
      "damage": "10"
    }
  ],
  "weaknesses": [
    {
      "type": "炎",
      "value": "×2"
    }
  ],
  "retreat_cost": [
    "無",
    "無"
  ],
  "converted_retreat_cost": 2,
  "number": "1",
  "printed_number": "001/098",
  "rarity": "通常",
  "artist": "YASHIRO Nanaco",
  "language": "Japanese",
  "language_code": "JA",
  "translation": {
    "en": {
      "name": "Pineco",
      "supertype": "Pokémon",
      "subtypes": [
        "Basic"
      ],
      "types": [
        "Grass"
      ],
      "attacks": [
        {
          "cost": [
            "Colorless"
          ],
          "name": "Hang Down",
          "text": "",
          "damage": "10"
        }
      ],
      "weaknesses": [
        {
          "type": "Fire",
          "value": "×2"
        }
      ],
      "retreat_cost": [
        "Colorless",
        "Colorless"
      ],
      "rarity": "Common"
    }
  }
}
All Pokemon related endpoints are available at https://api.scrydex.com/pokemon/v1/.

For example:

Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards'
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Pokemon
Cards
The card object
Each field available on a Pokémon card is described below with its field name and corresponding data type.

id <string>

The unique identifier for the card.

name <string>

The name of the Pokémon card.

supertype <string>

The supertype of the card (e.g., "Pokémon", "Trainer", "Energy").

subtypes <array of strings>

The subtypes for the card (e.g., "Stage 2", "MEGA", "GX").

types <array of strings>

The types of the Pokémon (e.g., "Fire", "Water", "Grass").

hp <string>

The total hit points (HP) of the Pokémon.

level <string>

The level of the card. This only pertains to cards from older sets and those of supertype Pokémon.

evolves_from <array of strings>

Which Pokémon(s) this card evolves from

rules <array of strings>

Any rules associated with the card. For example, VMAX rules, Mega rules, trainer rules, etc.

ancient_trait <map>

Special abilities or powers that the Pokémon has.

name <string>: The name of the ancient trait
text <string>: The text value of the ancient trait
abilities <array of maps>

Special abilities or powers that the Pokémon has.

type <string>: The type of ability (e.g., "Pokémon-Power", "Ability").
name <string>: The name of the ability.
text <string>: A description of the ability.
attacks <array of maps>

The attack(s) the Pokémon can perform.

cost <array of strings>: Energies required to perform the attack (e.g., "Fire", "Water").
converted_energy_cost <integer>: The summed cost of energies for the attack.
name <string>: The name of the attack.
text <string>: The description of the attack.
damage <string>: The damage the attack deals.
weaknesses <array of maps>

One or more weaknesses for a given card. A weakness has the following fields:

type <string>: The type of weakness, such as Fire or Water.
value <string>: The value of the weakness.
resistances <array of maps>

One or more resistances for a given card. A resistance has the following fields:

type <string>: The type of resistance, such as Fire or Water.
value <string>: The value of the resistance.
retreat_cost <array of strings>

A list of costs it takes to retreat and return the card to your bench.
Each cost is an energy type such as Water or Fire.

converted_retreat_cost <string>

The converted retreat cost for a card is the count of energy types found within the retreat_cost field.

number <string>

The card number in its set. If the printed number is 87/160, the number is 87.

printed_number <string>

The printed number is what is actually printed on the card, such as 87/160 or SWSH101

rarity <string>

The rarity of the card.

rarity_code <string>

The code representing the card's rarity.

artist <string>

The artist who illustrated the card.

national_pokedex_numbers <array of integers>

The Pokédex number(s) for the Pokémon.

flavor_text <string>

The flavor text of the card. This is the text that can be found on some cards that is usually italiced near the bottom of the card.

regulation_mark <string>

A letter symbol found on a card that identifies its legality. Introduce with the Sword & Shield series.

images <array of maps>

Contains URLs for the card's images in various sizes.

type <string>: The type of image (e.g., "front", "back").
small <string>: The URL of the small image.
medium <string>: The URL of the medium image.
large <string>: The URL of the large image.
expansion <object>

Details about the card's expansion or set.

id <string>: The ID of the expansion.
name <string>: The name of the expansion.
series <string>: The series of the expansion.
total <integer>: Total cards in the set, including secret rares.
printed_total <integer>: Number of cards in the set that are printed on a card. If a card is 87/160, the printed_total is 160.
language <string>: The language of the expansion.
language_code <string>: The language code of the expansion (e.g., "EN", "JA")
release_date <string>: The release date of the expansion, in the format YYYY/MM/DD.
is_online_only <boolean>: Indicates if the set is only available online, such as Pocket expansions.
language <string>

The language of the card.

language_code <string>

The language code of the card (e.g., "EN", "JA").

expansion_sort_order <integer>

The position of the card in the expansion, used for sorting.

variants <array of maps>

A list of collectible variants of the card.

name <string>: The name of the variant.
images <array of maps>: Any images available for the specific variant, such as a 1st edition image versus unlimited.
prices <array>: The price data for the variant. Requires include=prices in the request.
pop_reports <array of maps>: The population report data for the variant. Requires include=pop_reports in the request.
Here is an example JSON representation of the Pokémon card object:

{
  "id": "base1-4",
  "name": "Charizard",
  "supertype": "Pokémon",
  "subtypes": ["Stage 2"],
  "types": ["Fire"],
  "hp": "120",
  "abilities": [
    {
      "type": "Pokémon Power",
      "name": "Energy Burn",
      "text": "As often as you like during your turn (before your attack), you may turn all Energy attached to Charizard into Fire Energy for the rest of the turn. This power can't be used if Charizard is Asleep, Confused, or Paralyzed."
    }
  ],
  "attacks": [
    {
      "cost": ["Fire", "Fire", "Fire", "Fire"],
      "converted_energy_cost": 4,
      "name": "Fire Spin",
      "text": "Discard 2 Energy cards attached to Charizard in order to use this attack.",
      "damage": "100"
    }
  ],
  "number": "4",
  "rarity": "Rare Holo",
  "rarity_code": "★H",
  "artist": "Mitsuhiro Arita",
  "national_pokedex_numbers": [6],
  "images": [
    {
      "type": "front",
      "small": "https://images.scrydex.com/pokemon/base1-4/small",
      "medium": "https://images.scrydex.com/pokemon/base1-4/medium",
      "large": "https://images.scrydex.com/pokemon/base1-4/large"
    }
  ],
  "expansion": {
    "id": "base1",
    "name": "Base",
    "series": "Base",
    "total": 102,
    "printed_total": 102,
    "language": "English",
    "language_code": "EN",
    "release_date": "1999/01/09",
    "is_online_only": false
  },
  "language": "English",
  "language_code": "EN",
  "expansion_sort_order": 4,
  "variants": [
    {
      "name": "unlimitedHolofoil",
      "prices": [],
      "pop_reports": [
        {
          "company": "PSA",
          "total": 5445,
          "grade_total": 5211,
          "grades": [
            {
              "grade": "10",
              "count": 125
            },
            {
              "grade": "9",
              "count": 729
            }
          ]
        }
      ]
    },
    {
      "name": "firstEditionShadowlessHolofoil",
      "prices": []
    },
    {
      "name": "unlimitedShadowlessHolofoil",
      "prices": []
    }
  ]
}
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Get a card
This endpoint retrieves a specific Pokémon card by its unique identifier.

URL
GET https://api.scrydex.com/pokemon/v1/cards/<id>

URL Parameters
id <string>
The unique identifier of the card to retrieve. This is a required parameter.
Query Parameters
select <comma-separated string>

Specifies which fields to return in the response (e.g., "name,types,attacks").

casing <string>

Allows changing the output format of the response. Supported values are:

camel
snake
include <comma-separated string>

Fetch additional resources alongside the card. Supported values include:

prices (Fetches price details for the card. It is recommended to not include prices if you don't need that data for a given request.)
Here is how you can retrieve a card using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Search cards
Fetching and searching for multiple cards in the Scrydex API is simple yet powerful.
Use the various query parameters to customize your requests and retrieve the specific cards or data you need.

URL
There are two primary endpoints for fetching multiple cards: Searching across the whole card database, or scoped to a specific expansion.

Get all cards (paginated), unfiltered:

GET https://api.scrydex.com/pokemon/v1/cards

Get all cards (paginated), for a specific expansion:

GET https://api.scrydex.com/pokemon/v1/expansions/me1/cards

Both of these endpoints support the same query parameters and underlying search logic.

Query Parameters
All query parameters are optional, but combining them allows for advanced and targeted searches.

Note that all query parameters can be used with snake case or camel case (so pageSize or page_size are both acceptable).

Parameter	Description	Default Value
q	A search query for advanced filtering. Examples can be found below.	-
page	The page of data to access.	1
page_size	The maximum number of cards to return per page. The highest allowable value is 100.	100 (max: 100)
select	A comma-delimited list of fields to return in the response (e.g., ?select=id,name). If omitted, all fields are returned.	-
include	Used to include additional data, such as prices. These are fields you opt-in to, and aren't included in the response by default.	-
Key Features of q (Search Queries)
Search queries use a Lucene-like syntax for filtering, making it easy to build powerful card searches.
Below are examples of supported query operations:

Keyword Matching
Find cards that contain "charizard" in the name field: name:charizard
Search for the phrase "venusaur v" in the name field: name:"venusaur v"
Combine multiple conditions:
Cards with "charizard" in the name AND "mega" in the subtypes field: name:charizard subtypes:mega
Cards with "charizard" in the name AND either "mega" or "vmax" in subtypes: name:charizard (subtypes:mega OR subtypes:vmax)
Exclude Results
Retrieve only cards with subtypes:mega while excluding water types: subtypes:mega -types:water
Wildcard Matching
Cards where the name starts with "char": name:char*
Cards where the name starts with "char" and ends with "der": name:char*der
Exact Matching
Match cards where the name is exactly "charizard" (no other characters appear in the name field): !name:charizard
Range Searches
Fields containing numerical data (e.g., "hp", "national_pokedex_numbers") support range searches:

Cards featuring the original 151 Pokémon: national_pokedex_numbers:[1 TO 151]
Cards with HP values up to 100: hp:[* TO 100]
Cards with HP values greater than or equal to 150: hp:[150 TO *]
Pro Tip: Use square brackets [ ] for inclusive ranges, and curly braces { } for exclusive ranges.

Searching Nested Fields
Leverage the . separator to search nested fields:

Filter by expansion ID: expansion.id:sm1
Find cards with an attack named "Hypnosis": attacks.name:Hypnosis
Search for cards banned in Standard play: legalities.standard:banned

Here is an example JSON representation of the Pokémon card object:

{
  "id": "base1-4",
  "name": "Charizard",
  "supertype": "Pokémon",
  "subtypes": ["Stage 2"],
  "types": ["Fire"],
  "hp": "120",
  "abilities": [
    {
      "type": "Pokémon Power",
      "name": "Energy Burn",
      "text": "As often as you like during your turn (before your attack), you may turn all Energy attached to Charizard into Fire Energy for the rest of the turn. This power can't be used if Charizard is Asleep, Confused, or Paralyzed."
    }
  ],
  "attacks": [
    {
      "cost": ["Fire", "Fire", "Fire", "Fire"],
      "converted_energy_cost": 4,
      "name": "Fire Spin",
      "text": "Discard 2 Energy cards attached to Charizard in order to use this attack.",
      "damage": "100"
    }
  ],
  "number": "4",
  "rarity": "Rare Holo",
  "rarity_code": "★H",
  "artist": "Mitsuhiro Arita",
  "national_pokedex_numbers": [6],
  "images": [
    {
      "type": "front",
      "small": "https://images.scrydex.com/pokemon/base1-4/small",
      "medium": "https://images.scrydex.com/pokemon/base1-4/medium",
      "large": "https://images.scrydex.com/pokemon/base1-4/large"
    }
  ],
  "expansion": {
    "id": "base1",
    "name": "Base",
    "series": "Base",
    "total": 102,
    "printed_total": 102,
    "language": "English",
    "language_code": "EN",
    "release_date": "1999/01/09",
    "is_online_only": false
  },
  "language": "English",
  "language_code": "EN",
  "expansion_sort_order": 4,
  "variants": [
    {
      "name": "unlimitedHolofoil",
      "prices": [],
      "pop_reports": [
        {
          "company": "PSA",
          "total": 5445,
          "grade_total": 5211,
          "grades": [
            {
              "grade": "10",
              "count": 125
            },
            {
              "grade": "9",
              "count": 729
            }
          ]
        }
      ]
    },
    {
      "name": "firstEditionShadowlessHolofoil",
      "prices": []
    },
    {
      "name": "unlimitedShadowlessHolofoil",
      "prices": []
    }
  ]
}
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Here is how you can retrieve a card using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Example: Fetch & Search Cards
Use the query parameters to retrieve and search cards. Below are examples using Scrydex API:

Ordering Data
The orderBy parameter allows for flexible sorting of results:

Order cards by number within their set: ?orderBy=number
Combine ascending (ASC) and descending (DESC) order: ?orderBy=name,-number
Field Selection
Optimize and reduce response payload sizes using the select parameter to return only the fields you care about:

Example: Request only id and name fields for all cards: ?select=id,name
Response Example
Here’s a sample response for a search query:

{
  "status": "success",
  "data": [
    {
      "id": "xy7-54",
      "name": "Gardevoir-EX",
      "hp": 170,
      "types": ["Fairy"],
      "subtypes": ["EX"]
    },
    {
      "id": "sm3-20",
      "name": "Charizard-GX",
      "hp": 250,
      "types": ["Fire"],
      "subtypes": ["GX"]
    }
  ],
  "page": 1,
  "pageSize": 2,
  "totalCount": 5000
}
Best Practices for Fetching & Searching
Paginate Results: Use the page and pageSize parameters to prevent overloading responses.
Limit Fields Returned: Use the select parameter to only get the data you need.
Avoid Overhead: Minimize wildcard or range queries for better performance.

Pokemon
Cards
The card object
Each field available on a Pokémon card is described below with its field name and corresponding data type.

id <string>

The unique identifier for the card.

name <string>

The name of the Pokémon card.

supertype <string>

The supertype of the card (e.g., "Pokémon", "Trainer", "Energy").

subtypes <array of strings>

The subtypes for the card (e.g., "Stage 2", "MEGA", "GX").

types <array of strings>

The types of the Pokémon (e.g., "Fire", "Water", "Grass").

hp <string>

The total hit points (HP) of the Pokémon.

level <string>

The level of the card. This only pertains to cards from older sets and those of supertype Pokémon.

evolves_from <array of strings>

Which Pokémon(s) this card evolves from

rules <array of strings>

Any rules associated with the card. For example, VMAX rules, Mega rules, trainer rules, etc.

ancient_trait <map>

Special abilities or powers that the Pokémon has.

name <string>: The name of the ancient trait
text <string>: The text value of the ancient trait
abilities <array of maps>

Special abilities or powers that the Pokémon has.

type <string>: The type of ability (e.g., "Pokémon-Power", "Ability").
name <string>: The name of the ability.
text <string>: A description of the ability.
attacks <array of maps>

The attack(s) the Pokémon can perform.

cost <array of strings>: Energies required to perform the attack (e.g., "Fire", "Water").
converted_energy_cost <integer>: The summed cost of energies for the attack.
name <string>: The name of the attack.
text <string>: The description of the attack.
damage <string>: The damage the attack deals.
weaknesses <array of maps>

One or more weaknesses for a given card. A weakness has the following fields:

type <string>: The type of weakness, such as Fire or Water.
value <string>: The value of the weakness.
resistances <array of maps>

One or more resistances for a given card. A resistance has the following fields:

type <string>: The type of resistance, such as Fire or Water.
value <string>: The value of the resistance.
retreat_cost <array of strings>

A list of costs it takes to retreat and return the card to your bench.
Each cost is an energy type such as Water or Fire.

converted_retreat_cost <string>

The converted retreat cost for a card is the count of energy types found within the retreat_cost field.

number <string>

The card number in its set. If the printed number is 87/160, the number is 87.

printed_number <string>

The printed number is what is actually printed on the card, such as 87/160 or SWSH101

rarity <string>

The rarity of the card.

rarity_code <string>

The code representing the card's rarity.

artist <string>

The artist who illustrated the card.

national_pokedex_numbers <array of integers>

The Pokédex number(s) for the Pokémon.

flavor_text <string>

The flavor text of the card. This is the text that can be found on some cards that is usually italiced near the bottom of the card.

regulation_mark <string>

A letter symbol found on a card that identifies its legality. Introduce with the Sword & Shield series.

images <array of maps>

Contains URLs for the card's images in various sizes.

type <string>: The type of image (e.g., "front", "back").
small <string>: The URL of the small image.
medium <string>: The URL of the medium image.
large <string>: The URL of the large image.
expansion <object>

Details about the card's expansion or set.

id <string>: The ID of the expansion.
name <string>: The name of the expansion.
series <string>: The series of the expansion.
total <integer>: Total cards in the set, including secret rares.
printed_total <integer>: Number of cards in the set that are printed on a card. If a card is 87/160, the printed_total is 160.
language <string>: The language of the expansion.
language_code <string>: The language code of the expansion (e.g., "EN", "JA")
release_date <string>: The release date of the expansion, in the format YYYY/MM/DD.
is_online_only <boolean>: Indicates if the set is only available online, such as Pocket expansions.
language <string>

The language of the card.

language_code <string>

The language code of the card (e.g., "EN", "JA").

expansion_sort_order <integer>

The position of the card in the expansion, used for sorting.

variants <array of maps>

A list of collectible variants of the card.

name <string>: The name of the variant.
images <array of maps>: Any images available for the specific variant, such as a 1st edition image versus unlimited.
prices <array>: The price data for the variant. Requires include=prices in the request.
pop_reports <array of maps>: The population report data for the variant. Requires include=pop_reports in the request.
Here is an example JSON representation of the Pokémon card object:

{
  "id": "base1-4",
  "name": "Charizard",
  "supertype": "Pokémon",
  "subtypes": ["Stage 2"],
  "types": ["Fire"],
  "hp": "120",
  "abilities": [
    {
      "type": "Pokémon Power",
      "name": "Energy Burn",
      "text": "As often as you like during your turn (before your attack), you may turn all Energy attached to Charizard into Fire Energy for the rest of the turn. This power can't be used if Charizard is Asleep, Confused, or Paralyzed."
    }
  ],
  "attacks": [
    {
      "cost": ["Fire", "Fire", "Fire", "Fire"],
      "converted_energy_cost": 4,
      "name": "Fire Spin",
      "text": "Discard 2 Energy cards attached to Charizard in order to use this attack.",
      "damage": "100"
    }
  ],
  "number": "4",
  "rarity": "Rare Holo",
  "rarity_code": "★H",
  "artist": "Mitsuhiro Arita",
  "national_pokedex_numbers": [6],
  "images": [
    {
      "type": "front",
      "small": "https://images.scrydex.com/pokemon/base1-4/small",
      "medium": "https://images.scrydex.com/pokemon/base1-4/medium",
      "large": "https://images.scrydex.com/pokemon/base1-4/large"
    }
  ],
  "expansion": {
    "id": "base1",
    "name": "Base",
    "series": "Base",
    "total": 102,
    "printed_total": 102,
    "language": "English",
    "language_code": "EN",
    "release_date": "1999/01/09",
    "is_online_only": false
  },
  "language": "English",
  "language_code": "EN",
  "expansion_sort_order": 4,
  "variants": [
    {
      "name": "unlimitedHolofoil",
      "prices": [],
      "pop_reports": [
        {
          "company": "PSA",
          "total": 5445,
          "grade_total": 5211,
          "grades": [
            {
              "grade": "10",
              "count": 125
            },
            {
              "grade": "9",
              "count": 729
            }
          ]
        }
      ]
    },
    {
      "name": "firstEditionShadowlessHolofoil",
      "prices": []
    },
    {
      "name": "unlimitedShadowlessHolofoil",
      "prices": []
    }
  ]
}
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Get a card
This endpoint retrieves a specific Pokémon card by its unique identifier.

URL
GET https://api.scrydex.com/pokemon/v1/cards/<id>

URL Parameters
id <string>
The unique identifier of the card to retrieve. This is a required parameter.
Query Parameters
select <comma-separated string>

Specifies which fields to return in the response (e.g., "name,types,attacks").

casing <string>

Allows changing the output format of the response. Supported values are:

camel
snake
include <comma-separated string>

Fetch additional resources alongside the card. Supported values include:

prices (Fetches price details for the card. It is recommended to not include prices if you don't need that data for a given request.)
Here is how you can retrieve a card using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Search cards
Fetching and searching for multiple cards in the Scrydex API is simple yet powerful.
Use the various query parameters to customize your requests and retrieve the specific cards or data you need.

URL
There are two primary endpoints for fetching multiple cards: Searching across the whole card database, or scoped to a specific expansion.

Get all cards (paginated), unfiltered:

GET https://api.scrydex.com/pokemon/v1/cards

Get all cards (paginated), for a specific expansion:

GET https://api.scrydex.com/pokemon/v1/expansions/me1/cards

Both of these endpoints support the same query parameters and underlying search logic.

Query Parameters
All query parameters are optional, but combining them allows for advanced and targeted searches.

Note that all query parameters can be used with snake case or camel case (so pageSize or page_size are both acceptable).

Parameter	Description	Default Value
q	A search query for advanced filtering. Examples can be found below.	-
page	The page of data to access.	1
page_size	The maximum number of cards to return per page. The highest allowable value is 100.	100 (max: 100)
select	A comma-delimited list of fields to return in the response (e.g., ?select=id,name). If omitted, all fields are returned.	-
include	Used to include additional data, such as prices. These are fields you opt-in to, and aren't included in the response by default.	-
Key Features of q (Search Queries)
Search queries use a Lucene-like syntax for filtering, making it easy to build powerful card searches.
Below are examples of supported query operations:

Keyword Matching
Find cards that contain "charizard" in the name field: name:charizard
Search for the phrase "venusaur v" in the name field: name:"venusaur v"
Combine multiple conditions:
Cards with "charizard" in the name AND "mega" in the subtypes field: name:charizard subtypes:mega
Cards with "charizard" in the name AND either "mega" or "vmax" in subtypes: name:charizard (subtypes:mega OR subtypes:vmax)
Exclude Results
Retrieve only cards with subtypes:mega while excluding water types: subtypes:mega -types:water
Wildcard Matching
Cards where the name starts with "char": name:char*
Cards where the name starts with "char" and ends with "der": name:char*der
Exact Matching
Match cards where the name is exactly "charizard" (no other characters appear in the name field): !name:charizard
Range Searches
Fields containing numerical data (e.g., "hp", "national_pokedex_numbers") support range searches:

Cards featuring the original 151 Pokémon: national_pokedex_numbers:[1 TO 151]
Cards with HP values up to 100: hp:[* TO 100]
Cards with HP values greater than or equal to 150: hp:[150 TO *]
Pro Tip: Use square brackets [ ] for inclusive ranges, and curly braces { } for exclusive ranges.

Searching Nested Fields
Leverage the . separator to search nested fields:

Filter by expansion ID: expansion.id:sm1
Find cards with an attack named "Hypnosis": attacks.name:Hypnosis
Search for cards banned in Standard play: legalities.standard:banned

Getting Started
Pricing Data
Overview
The Scrydex API provides extensive pricing data for trading cards, enabling users to track price trends, access historical data, and gain insights into the value of their cards.
This pricing data spans raw and graded cards, with specific details tailored to each type.

In order to include pricing data in your API responses, you must use the include query parameter in your request, with a value of prices. (e.g., ?include=prices).

[!IMPORTANT]
The prices field on cards and variants will be empty or omitted unless include=prices is explicitly specified in your request.
See game specific endpoints for more details.

Each game endpoint uses the same contracts for pricing data.

Pricing Support by Card Game
The table below outlines pricing support for both raw and graded cards across various trading card games available in the API.

Card Game	Raw Prices	Graded Prices
Pokémon	✅ Supported	✅ Supported
Lorcana	✅ Supported	✅ Supported
Magic: The Gathering	✅ Supported	⏳ Coming Soon
Gundam	✅ Supported	⏳ Coming Soon
One Piece	✅ Supported	⏳ Coming Soon
Riftbound	✅ Supported	⏳ Coming Soon
Notes:
The various API teams are actively working on expanding support for graded pricing across all card games in future updates.
General Pricing Information
Currency Correlation
Pricing data is available in multiple currencies, depending on the market of the card. This ensures the data reflects the trading practices of specific regions.

USD: Prices from US markets.
JPY: Prices from Japanese markets.
For example:

Raw prices for Japanese cards are currently all reported in JPY, reflecting the Japanese trading market.
Similarly, prices in USD reflect the value of cards in the US market.
Notes:
We are actively working on extending the markets to cover Euros as well. This will be in a future update.
Pricing Metrics
Each price record includes the following key metrics:

Low Price (low): The lowest recorded price for the card.
Market Price (market): The average market price for the card, calculated across various sources.
Currency (currency): The currency in which the price values are represented (e.g., USD, JPY).
Trends Data
The API provides detailed trend analysis, showing how card prices fluctuate over time. Trends are available for the following time periods:

1 day
7 days
14 days
30 days
90 days
180 days
Each trend includes:

Price Change (price_change): The change in price over the specified period.
Percent Change (percent_change): The percentage change relative to the starting price.
As a reminder, the price_change will always be in whatever currency the price object is set to.

Sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'
Raw
The Pokémon API provides detailed raw price data with key metrics and trends.
Raw price data corresponds to the market value of physical cards in specific conditions.
Below are the available conditions, data fields, and trends that users can query.

Conditions
All raw price data is categorized based on card condition:

NM - Near Mint
LP - Lightly Played
MP - Moderately Played
HP - Heavily Played
DM - Damaged
Price Data Structure
Each raw price record provides the following fields:

condition: The card's condition (one of the above).
is_perfect: Indicates if the card is in flawless condition (default: false) Only valid for graded cards.
is_signed: Indicates if the card is autographed (default: false) Only valid for graded cards.
is_error: Indicates if the card contains a notable error (default: false) Only valid for graded cards.
type: Always set to "raw" for raw price data.
low: The lowest known price for this card in the specific condition (currency-specific).
market: The average market price for this card condition (currency-specific).
currency: The currency of the prices, e.g., "USD".
trends: Contains historical price trends over different time periods.
Here is a sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'
Graded
The Scrydex API provides extensive pricing data for graded cards, allowing users to track their value across multiple grading standards and time periods.
This data includes support for multiple grading companies and key pricing metrics, making it a robust tool for collectors and investors.

Supported Grading Companies
The API supports pricing data for the following grading companies:

PSA (Professional Sports Authenticator)
CGC (Certified Guaranty Company)
BGS (Beckett Grading Services)
TAG, SGC, and others (when available on a card-specific basis).
This ensures broad coverage for graded cards across major validation companies.

Pricing Metrics
Graded prices include the following metrics:

Low Price (low): The lowest recorded price for the card at the specified grade.
Mid Price (mid): The median price recorded for the card.
High Price (high): The highest recorded price for the card at the specified grade.
Market Price (market): The average market price across all available data.
Currency (currency): The currency of the pricing values (e.g., USD, JPY).
Using these metrics, you can analyze card value at different pricing levels across markets.

Graded Card Details
Grading-Specific Fields
Each graded card price record includes additional fields specific to grading:

Grade (grade): The grade assigned to the card, corresponding to the grading company's standards (e.g., 10, 9.5, 9).
Grading Company (company): The name of the grading company (e.g., PSA, CGC, BGS).
Perfect Card (is_perfect): Indicates if the grade denotes a flawless card, such a CGC Pristine 10 or TAG Pristine 10 (default: false).
Signed Card (is_signed): Indicates if the card is autographed (default: false).
Error Card (is_error): Indicates if the card has notable errors or defects recognized as collectible (default: false).
Type (type): Always set to "graded" for graded price dat

Sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Here is a sample raw price:

{
    "condition": "NM",
    "is_perfect": false,
    "is_signed": false,
    "is_error": false,
    "type": "raw",
    "low": 868.0,
    "market": 915.43,
    "currency": "USD",
    "trends": {
      "days_1": {
        "price_change": 0.0,
        "percent_change": 0.0
      },
      "days_7": {
        "price_change": -16.59,
        "percent_change": -1.78
      },
      "days_14": {
        "price_change": -44.32,
        "percent_change": -4.62
      },
      "days_30": {
        "price_change": -95.64,
        "percent_change": -9.46
      },
      "days_90": {
        "price_change": -365.6,
        "percent_change": -28.54
      },
      "days_180": {
        "price_change": -646.65,
        "percent_change": -41.4
      }
    }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Here is a sample graded price:

{
  "grade": "10",
  "company": "PSA",
  "is_perfect": false,
  "is_signed": false,
  "is_error": false,
  "type": "graded",
  "low": 2350.0,
  "mid": 2566.0,
  "high": 2650.0,
  "market": 2567.88,
  "currency": "USD",
  "trends": {
    "days_1": {
      "price_change": 111.75,
      "percent_change": 4.55
    },
    "days_7": {
      "price_change": 111.75,
      "percent_change": 4.55
    },
    "days_14": {
      "price_change": -11.3,
      "percent_change": -0.44
    },
    "days_30": {
      "price_change": -10.93,
      "percent_change": -0.42
    },
    "days_90": {
      "price_change": -153.12,
      "percent_change": -5.63
    },
    "days_180": {
      "price_change": -1658.19,
      "percent_change": -39.24
    }
  }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Graded
The Scrydex API provides extensive pricing data for graded cards, allowing users to track their value across multiple grading standards and time periods.
This data includes support for multiple grading companies and key pricing metrics, making it a robust tool for collectors and investors.

Supported Grading Companies
The API supports pricing data for the following grading companies:

PSA (Professional Sports Authenticator)
CGC (Certified Guaranty Company)
BGS (Beckett Grading Services)
TAG, SGC, and others (when available on a card-specific basis).
This ensures broad coverage for graded cards across major validation companies.

Pricing Metrics
Graded prices include the following metrics:

Low Price (low): The lowest recorded price for the card at the specified grade.
Mid Price (mid): The median price recorded for the card.
High Price (high): The highest recorded price for the card at the specified grade.
Market Price (market): The average market price across all available data.
Currency (currency): The currency of the pricing values (e.g., USD, JPY).
Using these metrics, you can analyze card value at different pricing levels across markets.

Graded Card Details
Grading-Specific Fields
Each graded card price record includes additional fields specific to grading:

Grade (grade): The grade assigned to the card, corresponding to the grading company's standards (e.g., 10, 9.5, 9).
Grading Company (company): The name of the grading company (e.g., PSA, CGC, BGS).
Perfect Card (is_perfect): Indicates if the grade denotes a flawless card, such a CGC Pristine 10 or TAG Pristine 10 (default: false).
Signed Card (is_signed): Indicates if the card is autographed (default: false).
Error Card (is_error): Indicates if the card has notable errors or defects recognized as collectible (default: false).
Type (type): Always set to "graded" for graded price data.

Here is a sample graded price:

{
  "grade": "10",
  "company": "PSA",
  "is_perfect": false,
  "is_signed": false,
  "is_error": false,
  "type": "graded",
  "low": 2350.0,
  "mid": 2566.0,
  "high": 2650.0,
  "market": 2567.88,
  "currency": "USD",
  "trends": {
    "days_1": {
      "price_change": 111.75,
      "percent_change": 4.55
    },
    "days_7": {
      "price_change": 111.75,
      "percent_change": 4.55
    },
    "days_14": {
      "price_change": -11.3,
      "percent_change": -0.44
    },
    "days_30": {
      "price_change": -10.93,
      "percent_change": -0.42
    },
    "days_90": {
      "price_change": -153.12,
      "percent_change": -5.63
    },
    "days_180": {
      "price_change": -1658.19,
      "percent_change": -39.24
    }
  }
}
Example Request
Lang:

CURL
curl -X GET 'https://api.scrydex.com/pokemon/v1/cards?include=prices' \
-H 'X-Api-Key: YOUR_API_KEY' \
-H 'X-Team-ID: YOUR_TEAM_ID'

Pokemon
Expansions
The expansion object
Each field available on a Pokémon expansion is described below with its field name and corresponding data type.

id <string>

The unique identifier for the expansion.

name <string>

The name of the Pokémon card.

series <string>

The series the expansion belongs to (Like Scarlet & Violet).

code <string>

The unique code for the expansion.

total <integer>

The total number of cards (including secret rares) in the expansion. Variants are not counted separately.

printed_total <integer>

The number of cards printed on the expansion, such as 86 in Black Bolt (1/82, 2/86, etc.)

language <string>

The language of the expansion (e.g. English).

language_code <string>

The language code (ISO 2) of the expansion (e.g. EN or JA).

release_date <string>

The release date of the expansion in format YYYY/MM/DD (e.g. 2025/07/18).

is_online_only <boolean>

Whether the expansion is only available online, such as Pokemon Pocket expansions.

logo <string>

The logo url of the expansion.

symbol <string>

The symbol url of the expansion.

translation <map>

If the expansion is in a language other than English, this field will contain the translation of the expansion nested in a en field

name <string>: The name of the expansion in English.
Here is an example JSON representation of the Pokémon expansion object:

{
  "id": "zsv10pt5",
  "name": "Black Bolt",
  "series": "Scarlet & Violet",
  "code": "BLK",
  "total": 172,
  "printed_total": 86,
  "language": "English",
  "language_code": "EN",
  "release_date": "2025/07/18",
  "is_online_only": false,
  "logo": "https://images.scrydex.com/pokemon/zsv10pt5-logo/logo",
  "symbol": "https://images.scrydex.com/pokemon/zsv10pt5-symbol/symbol"
}
Here is a sample in Japanese:

{
      "id": "m1s_ja",
      "name": "メガシンフォニア",
      "series": "Mega Evolution",
      "code": "M1S",
      "total": 92,
      "printed_total": 63,
      "language": "Japanese",
      "language_code": "JA",
      "release_date": "2025/08/01",
      "is_online_only": false,
      "logo": "https://images.scrydex.com/pokemon/m1s_ja-logo/logo",
      "symbol": "https://images.scrydex.com/pokemon/m1s_ja-symbol/symbol",
      "translation": {
        "en": {
          "name": "Mega Symphonia"
        }
      }
    },
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions/sv1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Get an expansion
This endpoint retrieves a specific Pokémon expansion by its unique identifier.

URL
GET https://api.scrydex.com/pokemon/v1/expansions/<id>

URL Parameters
id <string>
The unique identifier of the expansion to retrieve. This is a required parameter.
Query Parameters
select <comma-separated string>

Specifies which fields to return in the response (e.g., "name,logo").

casing <string>

Allows changing the output format of the response. Supported values are:

camel
snake
Here is how you can retrieve an expansion using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions/sv1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Search expansions
Fetching and searching for multiple expansions in the Scrydex API is simple yet powerful.
Use the various query parameters to customize your requests and retrieve the specific cards or data you need.

Query Parameters
All query parameters are optional, but combining them allows for advanced and targeted searches.

Note that all query parameters can be used with snake case or camel case (so pageSize or page_size are both acceptable).

Parameter	Description	Default Value
q	A search query for advanced filtering. Examples can be found below.	-
page	The page of data to access.	1
page_size	The maximum number of cards to return per page. The highest allowable value is 100.	100 (max: 100)
select	A comma-delimited list of fields to return in the response (e.g., ?select=id,name). If omitted, all fields are returned.	-
Key Features of q (Search Queries)
Search queries use a Lucene-like syntax for filtering, making it easy to build powerful card searches.
Below are examples of supported query operations:

Keyword Matching
Find expansions that contain "mega" in the name field: name:mega
Search for the phrase "mega brave" in the name field: name:"mega brave"
Combine multiple conditions:
Expansions with the series "XY" and language "Japanese" series:XY language:japanese
Expansions with the series "XY" and the language of "Japanse" OR "English" series:XY (language:japanese OR language:english)
Exclude Results
Retrieve only expansions with series:xy while excluding english series:xy -language:english
Wildcard Matching
Expansions where the name starts with "twi": name:twi*
Expansions where the name starts with "twi" and ends with "ght": name:twi*ght
Exact Matching
Match expansions where the name is exactly "lost thunder" (no other characters appear in the name field): !name:"lost thunder"
Range Searches
Fields containing numerical data (e.g., "total", "printed_total") support range searches:

Expansions with at least 200 cards: total:[200 TO *]
Expansions with at most 100 cards: total:[* TO 100]
Expansions with a printed total of 100 or more: total:[100 TO *]
Pro Tip: Use square brackets [ ] for inclusive ranges, and curly braces { } for exclusive ranges.

Get an expansion
This endpoint retrieves a specific Pokémon expansion by its unique identifier.

URL
GET https://api.scrydex.com/pokemon/v1/expansions/<id>

URL Parameters
id <string>
The unique identifier of the expansion to retrieve. This is a required parameter.
Query Parameters
select <comma-separated string>

Specifies which fields to return in the response (e.g., "name,logo").

casing <string>

Allows changing the output format of the response. Supported values are:

camel
snake
Here is how you can retrieve an expansion using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions/sv1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Search expansions
Fetching and searching for multiple expansions in the Scrydex API is simple yet powerful.
Use the various query parameters to customize your requests and retrieve the specific cards or data you need.

Query Parameters
All query parameters are optional, but combining them allows for advanced and targeted searches.

Note that all query parameters can be used with snake case or camel case (so pageSize or page_size are both acceptable).

Parameter	Description	Default Value
q	A search query for advanced filtering. Examples can be found below.	-
page	The page of data to access.	1
page_size	The maximum number of cards to return per page. The highest allowable value is 100.	100 (max: 100)
select	A comma-delimited list of fields to return in the response (e.g., ?select=id,name). If omitted, all fields are returned.	-
Key Features of q (Search Queries)
Search queries use a Lucene-like syntax for filtering, making it easy to build powerful card searches.
Below are examples of supported query operations:

Keyword Matching
Find expansions that contain "mega" in the name field: name:mega
Search for the phrase "mega brave" in the name field: name:"mega brave"
Combine multiple conditions:
Expansions with the series "XY" and language "Japanese" series:XY language:japanese
Expansions with the series "XY" and the language of "Japanse" OR "English" series:XY (language:japanese OR language:english)
Exclude Results
Retrieve only expansions with series:xy while excluding english series:xy -language:english
Wildcard Matching
Expansions where the name starts with "twi": name:twi*
Expansions where the name starts with "twi" and ends with "ght": name:twi*ght
Exact Matching
Match expansions where the name is exactly "lost thunder" (no other characters appear in the name field): !name:"lost thunder"
Range Searches
Fields containing numerical data (e.g., "total", "printed_total") support range searches:

Expansions with at least 200 cards: total:[200 TO *]
Expansions with at most 100 cards: total:[* TO 100]
Expansions with a printed total of 100 or more: total:[100 TO *]
Pro Tip: Use square brackets [ ] for inclusive ranges, and curly braces { } for exclusive ranges.

Here is an example JSON representation of the Pokémon expansion object:

{
  "id": "zsv10pt5",
  "name": "Black Bolt",
  "series": "Scarlet & Violet",
  "code": "BLK",
  "total": 172,
  "printed_total": 86,
  "language": "English",
  "language_code": "EN",
  "release_date": "2025/07/18",
  "is_online_only": false,
  "logo": "https://images.scrydex.com/pokemon/zsv10pt5-logo/logo",
  "symbol": "https://images.scrydex.com/pokemon/zsv10pt5-symbol/symbol"
}
Here is a sample in Japanese:

{
      "id": "m1s_ja",
      "name": "メガシンフォニア",
      "series": "Mega Evolution",
      "code": "M1S",
      "total": 92,
      "printed_total": 63,
      "language": "Japanese",
      "language_code": "JA",
      "release_date": "2025/08/01",
      "is_online_only": false,
      "logo": "https://images.scrydex.com/pokemon/m1s_ja-logo/logo",
      "symbol": "https://images.scrydex.com/pokemon/m1s_ja-symbol/symbol",
      "translation": {
        "en": {
          "name": "Mega Symphonia"
        }
      }
    },

    Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions/sv1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Here is how you can retrieve an expansion using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/expansions/sv1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Example: Fetch & Search Expansions
Use the query parameters to retrieve and search expansions. Below are examples using Scrydex API:

Ordering Data
The orderBy parameter allows for flexible sorting of results:

Order expansions by name: ?orderBy=name
Combine ascending (ASC) and descending (DESC) order: ?orderBy=name,-total
Field Selection
Optimize and reduce response payload sizes using the select parameter to return only the fields you care about:

Example: Request only id and name fields for all cards: ?select=id,name
Response Example
Here’s a sample response for a search query:

{
  "data": [
    {
      "id": "sm11",
      "name": "Unified Minds",
      "series": "Sun & Moon",
      "total": 260,
      "printed_total": 236,
      "language": "English",
      "language_code": "EN",
      "release_date": "2019/08/02",
      "is_online_only": false,
      "logo": "https://images.scrydex.com/pokemon/sm11-logo/logo",
      "symbol": "https://images.scrydex.com/pokemon/sm11-symbol/symbol"
    },
    {
      "id": "sm10",
      "name": "Unbroken Bonds",
      "series": "Sun & Moon",
      "total": 234,
      "printed_total": 214,
      "language": "English",
      "language_code": "EN",
      "release_date": "2019/05/03",
      "is_online_only": false,
      "logo": "https://images.scrydex.com/pokemon/sm10-logo/logo",
      "symbol": "https://images.scrydex.com/pokemon/sm10-symbol/symbol"
    },
    ...
  ],
  "page": 1,
  "pageSize": 100,
  "totalCount": 200
}
Best Practices for Fetching & Searching
Paginate Results: Use the page and pageSize parameters to prevent overloading responses.
Limit Fields Returned: Use the select parameter to only get the data you need.
Avoid Overhead: Minimize wildcard or range queries for better performance.

Pokemon
Sealed Products
The sealed product object
Each field available on a Pokémon sealed product is described below with its field name and corresponding data type.

id <string>

The unique identifier for the sealed product.

name <string>

The name of the sealed product.

description <string>

A brief description of the sealed product.

type <string>

The type of sealed product (e.g., "Booster Pack", "Booster Box", "Elite Trainer Box").

images <array of maps>

Contains URLs for the card's images in various sizes.

type <string>: The type of image (e.g., "front", "back").
small <string>: The URL of the small image.
medium <string>: The URL of the medium image.
large <string>: The URL of the large image.
expansion <object>

Details about the expansion this sealed product belongs to.

id <string>: The ID of the expansion.
name <string>: The name of the expansion.
series <string>: The series of the expansion.
total <integer>: Total cards in the set, including secret rares.
printed_total <integer>: Number of cards in the set that are printed on a card. If a card is 87/160, the printed_total is 160.
language <string>: The language of the expansion.
language_code <string>: The language code of the expansion (e.g., "EN", "JA")
release_date <string>: The release date of the expansion, in the format YYYY/MM/DD.
is_online_only <boolean>: Indicates if the set is only available online, such as Pocket expansions.
language <string>

The language of the sealed product.

language_code <string>

The language code of the sealed product (e.g., "EN", "JA").

expansion_sort_order <integer>

The position of the sealed product in the expansion, used for sorting.

variants <array of maps>

A list of collectible variants of the card.

name <string>: The name of the variant.
images <array of maps>: Any images available for the specific variant, such as a 1st edition image versus unlimited.
prices <array>: The price data for the variant.
Here is an example JSON representation of the Pokémon sealed product object:

{
  "id": "me1-s1",
  "name": "Mega Evolution Booster Pack",
  "type": "Booster Pack",
  "description": "Mega Evolve Your Strength to the Next Stage!\nStriving to become stronger, Pokémon of all types are putting everything on the line to become Mega Evolution Pokémon ex! Harness the strong aura of Mega Lucario ex, embrace the overflowing power of Mega Gardevoir ex, and team up with more of these powerful Pokémon that boast devastating attacks and massive HP. But consider your strategy carefully—extra power brings extra risks! Choose your Pokémon partners and prepare for the biggest battles you’ve ever seen in the Pokémon TCG: Mega Evolution expansion!\n\nEach pack contains 10 cards.",
  "images": [
    {
      "type": "front",
      "small": "https://images.scrydex.com/pokemon/me1-s1/small",
      "medium": "https://images.scrydex.com/pokemon/me1-s1/medium",
      "large": "https://images.scrydex.com/pokemon/me1-s1/large"
    }
  ],
  "expansion": {
    "id": "me1",
    "name": "Mega Evolution",
    "series": "Mega Evolution",
    "code": "MEG",
    "total": 188,
    "printed_total": 132,
    "language": "English",
    "language_code": "EN",
    "release_date": "2025/09/26",
    "is_online_only": false
  },
  "expansion_sort_order": 1,
  "variants": [
    {
      "name": "normal",
      "prices": [
        {
          "condition": "U",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 7.39,
          "market": 7.13,
          "currency": "USD",
          "trends": {
            "days_1": {
              "price_change": 0.25,
              "percent_change": 3.63
            },
            "days_7": {
              "price_change": -0.76,
              "percent_change": -9.63
            }
          }
        }
      ]
    }
  ]
}
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/sealed/me1-s1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Get a sealed product
This endpoint retrieves a specific Pokémon sealed product by its unique identifier.

URL
GET https://api.scrydex.com/pokemon/v1/sealed/<id>

URL Parameters
id <string>
The unique identifier of the sealed product to retrieve. This is a required parameter.
Query Parameters
select <comma-separated string>

Specifies which fields to return in the response (e.g., "type,description").

casing <string>

Allows changing the output format of the response. Supported values are:

camel
snake
include <comma-separated string>

Fetch additional resources alongside the card. Supported values include:

prices (Fetches price details for the card. It is recommended to not include prices if you don't need that data for a given request.)
Here is how you can retrieve a card using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/sealed/me1-s1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'
Search sealed products
Fetching and searching for multiple sealed products in the Scrydex API is simple yet powerful.
Use the various query parameters to customize your requests and retrieve the specific sealed products or data you need.

URL
There are two primary endpoints for fetching multiple sealed products: Searching across the whole database, or scoped to a specific expansion.

Get all sealed products (paginated), unfiltered:

GET https://api.scrydex.com/pokemon/v1/sealed

Get all sealed products (paginated), for a specific expansion:

GET https://api.scrydex.com/pokemon/v1/expansions/me1/sealed

Both of these endpoints support the same query parameters and underlying search logic.

Query Parameters
All query parameters are optional, but combining them allows for advanced and targeted searches.

Note that all query parameters can be used with snake case or camel case (so pageSize or page_size are both acceptable).

Parameter	Description	Default Value
q	A search query for advanced filtering. Examples can be found below.	-
page	The page of data to access.	1
page_size	The maximum number of sealed products to return per page. The highest allowable value is 100.	100 (max: 100)
select	A comma-delimited list of fields to return in the response (e.g., ?select=id,name). If omitted, all fields are returned.	-
include	Used to include additional data, such as prices. These are fields you opt-in to, and aren't included in the response by default.	-
Key Features of q (Search Queries)
Search queries use a Lucene-like syntax for filtering, making it easy to build powerful sealed product searches.
Below are examples of supported query operations:

Keyword Matching
Find sealed products that contain "charizard" in the name field: name:charizard
Search for the phrase "venusaur v" in the name field: name:"venusaur v"
Combine multiple conditions:
Sealed products with "alakazam" in the name AND "Booster Pack" in the type field: name:alakazam type:"Booster Pack"
Sealed products with "alakazam" in the name AND either "Booster Pack" or "Booster Box" in type: name:alakazam (type:"Booster Pack" OR type:"Booster Box")
Exclude Results
Retrieve only sealed products with type:box while excluding base set: type:box -expansion.id:base1
Wildcard Matching
Products where the name starts with "char": name:char*
Products where the name starts with "char" and ends with "der": name:char*der
Exact Matching
Match sealed products where the name is exactly "jungle booster box" (no other characters appear in the name field): !name:"jungle booster box"
Range Searches
Fields containing numerical data (e.g., "hp", "national_pokedex_numbers") support range searches:

Currently no fields in a sealed product support range searches.
Pro Tip: Use square brackets [ ] for inclusive ranges, and curly braces { } for exclusive ranges.

Searching Nested Fields
Leverage the . separator to search nested fields:

Filter by expansion ID: expansion.id:sm1

Here is an example JSON representation of the Pokémon sealed product object:

{
  "id": "me1-s1",
  "name": "Mega Evolution Booster Pack",
  "type": "Booster Pack",
  "description": "Mega Evolve Your Strength to the Next Stage!\nStriving to become stronger, Pokémon of all types are putting everything on the line to become Mega Evolution Pokémon ex! Harness the strong aura of Mega Lucario ex, embrace the overflowing power of Mega Gardevoir ex, and team up with more of these powerful Pokémon that boast devastating attacks and massive HP. But consider your strategy carefully—extra power brings extra risks! Choose your Pokémon partners and prepare for the biggest battles you’ve ever seen in the Pokémon TCG: Mega Evolution expansion!\n\nEach pack contains 10 cards.",
  "images": [
    {
      "type": "front",
      "small": "https://images.scrydex.com/pokemon/me1-s1/small",
      "medium": "https://images.scrydex.com/pokemon/me1-s1/medium",
      "large": "https://images.scrydex.com/pokemon/me1-s1/large"
    }
  ],
  "expansion": {
    "id": "me1",
    "name": "Mega Evolution",
    "series": "Mega Evolution",
    "code": "MEG",
    "total": 188,
    "printed_total": 132,
    "language": "English",
    "language_code": "EN",
    "release_date": "2025/09/26",
    "is_online_only": false
  },
  "expansion_sort_order": 1,
  "variants": [
    {
      "name": "normal",
      "prices": [
        {
          "condition": "U",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 7.39,
          "market": 7.13,
          "currency": "USD",
          "trends": {
            "days_1": {
              "price_change": 0.25,
              "percent_change": 3.63
            },
            "days_7": {
              "price_change": -0.76,
              "percent_change": -9.63
            }
          }
        }
      ]
    }
  ]
}
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/sealed/me1-s1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Here is how you can retrieve a card using various programming languages (SDKs coming soon):

Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/sealed/me1-s1 \
  --header 'X-Api-Key: <api_key_here>'
  --header 'X-Team-ID: <team_id_here>'

  Example: Fetch & Search Sealed Products
Use the query parameters to retrieve and search sealed products. Below are examples using Scrydex API:

Ordering Data
The orderBy parameter allows for flexible sorting of results:

Order sealed products by name within their set: ?orderBy=name
Combine ascending (ASC) and descending (DESC) order: ?orderBy=name,-expansion_sort_order
Field Selection
Optimize and reduce response payload sizes using the select parameter to return only the fields you care about:

Example: Request only id and name fields for all sealed products: ?select=id,name
Response Example
Here’s a sample response for a search query:

{
  "status": "success",
  "data": [
    {
      "id": "base2-s2",
      "name": "Jungle Booster Box",
      "type": "Booster Box",
      "images": [
        {
          "type": "front",
          "small": "https://images.scrydex.com/pokemon/base2-s2f/small",
          "medium": "https://images.scrydex.com/pokemon/base2-s2f/medium",
          "large": "https://images.scrydex.com/pokemon/base2-s2f/large"
        }
      ],
      "expansion": {
        "id": "base2",
        "name": "Jungle",
        "series": "Base",
        "total": 64,
        "printed_total": 64,
        "language": "English",
        "language_code": "EN",
        "release_date": "1999/06/16",
        "is_online_only": false
      },
      "expansion_sort_order": 2,
      "variants": [
        {
          "name": "firstEdition",
          "prices": []
        },
        {
          "name": "unlimited",
          "prices": []
        }
      ]
    },
    {
      "id": "base3-s2",
      "name": "Pokemon Fossil Booster Box",
      "type": "Booster Box",
      "images": [
        {
          "type": "front",
          "small": "https://images.scrydex.com/pokemon/base3-s2f/small",
          "medium": "https://images.scrydex.com/pokemon/base3-s2f/medium",
          "large": "https://images.scrydex.com/pokemon/base3-s2f/large"
        }
      ],
      "expansion": {
        "id": "base3",
        "name": "Fossil",
        "series": "Base",
        "total": 62,
        "printed_total": 62,
        "language": "English",
        "language_code": "EN",
        "release_date": "1999/10/10",
        "is_online_only": false
      },
      "expansion_sort_order": 2,
      "variants": [
        {
          "name": "firstEdition",
          "prices": []
        },
        {
          "name": "unlimited",
          "prices": []
        }
      ]
    }
  ],
  "page": 1,
  "pageSize": 2,
  "totalCount": 263
}
Best Practices for Fetching & Searching
Paginate Results: Use the page and pageSize parameters to prevent overloading responses.
Limit Fields Returned: Use the select parameter to only get the data you need.
Avoid Overhead: Minimize wildcard or range queries for better performance.

Pokemon
Price History
The price history object
The price history object contains a list of historical price points for a specific card.

data <array of maps>

A list of price history entries, each representing a single day.

date <string>: The date for the price record (YYYY-MM-DD).
prices <array of maps>: A list of prices for various variants and conditions on that date.
variant <string>: The variant of the card (e.g., "normal", "reverseHolofoil").
condition <string>: The condition of the card (e.g., "NM", "LP", "MP", "DM").
is_perfect <boolean>: Indicates if the card is in perfect condition (e.g., PSA 10).
is_signed <boolean>: Indicates if the card is signed.
is_error <boolean>: Indicates if the card is an error card.
type <string>: The type of price (e.g., "raw", "graded").
low <number>: The lowest price recorded for this variant and condition on this date.
market <number>: The market price recorded for this variant and condition on this date.
currency <string>: The currency of the prices (e.g., "USD").
page <integer>

The current page of results.

page_size <integer>

The number of results per page.

count <integer>

The number of items in the current response.

total_count <integer>

The total number of items available.

Here is an example JSON representation of the price history object:

{
  "data": [
    {
      "date": "2026-03-24",
      "prices": [
        {
          "variant": "normal",
          "condition": "NM",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.01,
          "market": 0.08,
          "currency": "USD"
        },
        {
          "variant": "normal",
          "condition": "LP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.01,
          "market": 0.03,
          "currency": "USD"
        },
        {
          "variant": "normal",
          "condition": "MP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.05,
          "market": 0.05,
          "currency": "USD"
        },
        {
          "variant": "normal",
          "condition": "DM",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "market": 0.01,
          "currency": "USD"
        },
        {
          "variant": "reverseHolofoil",
          "condition": "NM",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.05,
          "market": 0.18,
          "currency": "USD"
        },
        {
          "variant": "reverseHolofoil",
          "condition": "LP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.12,
          "market": 0.16,
          "currency": "USD"
        },
        {
          "variant": "reverseHolofoil",
          "condition": "MP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.24,
          "market": 0.06,
          "currency": "USD"
        }
      ]
    },
    {
      "date": "2026-03-23",
      "prices": [
        {
          "variant": "normal",
          "condition": "NM",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.01,
          "market": 0.08,
          "currency": "USD"
        },
        {
          "variant": "normal",
          "condition": "LP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.01,
          "market": 0.03,
          "currency": "USD"
        },
        {
          "variant": "normal",
          "condition": "MP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.05,
          "market": 0.05,
          "currency": "USD"
        },
        {
          "variant": "normal",
          "condition": "DM",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "market": 0.01,
          "currency": "USD"
        },
        {
          "variant": "reverseHolofoil",
          "condition": "NM",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.05,
          "market": 0.19,
          "currency": "USD"
        },
        {
          "variant": "reverseHolofoil",
          "condition": "LP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.12,
          "market": 0.16,
          "currency": "USD"
        },
        {
          "variant": "reverseHolofoil",
          "condition": "MP",
          "is_perfect": false,
          "is_signed": false,
          "is_error": false,
          "type": "raw",
          "low": 0.24,
          "market": 0.06,
          "currency": "USD"
        }
      ]
    }
  ],
  "page": 1,
  "page_size": 30,
  "count": 2,
  "total_count": 2
}
Example Request
Lang:

CURL
curl --request GET \
  --url https://api.scrydex.com/pokemon/v1/cards/xy1-1/price_history \
  --header 'X-Api-Key: <api_key_here>' \
  --header 'X-Team-ID: <team_id_here>'
Get price history
This endpoint retrieves a list of historical price points for a specific card by its unique identifier.

URL
GET https://api.scrydex.com/pokemon/v1/cards/<id>/price_history

URL Parameters
id <string>
The unique identifier of the card to retrieve price history for. This is a required parameter.
Query Parameters
days <integer>

The number of days back from the current day to fetch price history for.

start_date <string>

The start date for the price history range (format: YYYY-MM-DD).

end_date <string>

The end date for the price history range (format: YYYY-MM-DD).

variant <string>

Filter the results by variant.

condition <string>

Filter the results by condition (e.g., "NM", "LP").

company <string>

Filter the results by grading company.

grade <string>

Filter the results by grade.

is_perfect <boolean>

Filter by perfect condition.

is_error <boolean>

Filter by error card.

is_signed <boolean>

Filter by signed card.

page <integer>

The current page of results.

page_size <integer>

The number of results per page.

Pokemon
Webhooks
Prices
Price webhooks notify you whenever there is an update to the market pricing for Pokémon cards. This includes both raw and graded price updates.

Supported Events
pokemon.expansions.prices.raw_updated: Triggered when raw card prices are updated.
pokemon.expansions.prices.graded_updated: Triggered when graded card prices are updated.
Payload Structure
The payload contains an expansion_ids array, which lists the IDs of the expansions that had price updates. You can then use the Search Cards endpoint with these expansion IDs to fetch the latest pricing data.

id <string>

Unique identifier for the webhook event.

name <string>

The name of the event (e.g., pokemon.expansions.prices.raw_updated).

data <object>

The event data containing expansion_ids.

Sample Payload
{
  "id": "evt_pkmn_prices_123",
  "name": "pokemon.expansions.prices.raw_updated",
  "data": {
    "expansion_ids": ["base1", "base2", "base3"]
  }
}
Example Request
Lang:

CURL
# No curl example needed for receiving webhooks, but we include it for consistency.
# Use this to simulate a webhook if needed:
curl -X POST 'https://your-app.com/webhooks' \
-H 'Content-Type: application/json' \
-H 'X-Scrydex-Signature: t=123,v1=abc' \
-d '{"id":"evt_pkmn_prices_123","name":"pokemon.expansions.prices.raw_updated","data":{"expansion_ids":["base1"]}}'
Pop Reports
Population report webhooks notify you whenever there is an update to the population data for Pokémon cards.

Supported Events
pokemon.expansions.pop_reports.updated: Triggered when population report data is updated.
Payload Structure
The payload contains an expansion_ids array, which lists the IDs of the expansions that had population report updates.

id <string>

Unique identifier for the webhook event.

name <string>

The name of the event (e.g., pokemon.expansions.pop_reports.updated).

data <object>

The event data containing expansion_ids.

Sample Payload
{
  "id": "evt_pkmn_prices_123",
  "name": "pokemon.expansions.prices.raw_updated",
  "data": {
    "expansion_ids": ["base1", "base2", "base3"]
  }
}
Example Request
Lang:

CURL
# No curl example needed for receiving webhooks, but we include it for consistency.
# Use this to simulate a webhook if needed:
curl -X POST 'https://your-app.com/webhooks' \
-H 'Content-Type: application/json' \
-H 'X-Scrydex-Signature: t=123,v1=abc' \
-d '{"id":"evt_pkmn_prices_123","name":"pokemon.expansions.prices.raw_updated","data":{"expansion_ids":["base1"]}}'

Sample Payload
{
  "id": "evt_pkmn_pop_123",
  "name": "pokemon.expansions.pop_reports.updated",
  "data": {
    "expansion_ids": ["base1"]
  }
}
Example Request
Lang:

CURL
curl -X POST 'https://your-app.com/webhooks' \
-H 'Content-Type: application/json' \
-H 'X-Scrydex-Signature: t=123,v1=abc' \
-d '{"id":"evt_pkmn_pop_123","name":"pokemon.expansions.pop_reports.updated","data":{"expansion_ids":["base1"]}}'

Vision
API Reference
Overview
Scrydex Vision is our advanced computer vision API designed to identify trading cards from images. By leveraging machine learning models trained on millions of card images, Vision can accurately determine the card's identity, including its game, expansion, and specific variant.

Vision can also extract details from graded cards, such as the grading company, grade number, and certification number, making it an essential tool for inventory management and marketplace integrations.

Key Features
Auto-Identification: Automatically detect the TCG, expansion, and card number.
Grading Detection: Extract grading information (PSA, BGS, CGC, and TAG currently supported) from slabbed cards.
Multi-TCG Support: Identify cards from Pokémon, Magic: The Gathering, Lorcana, One Piece, Riftbound, and Gundam.
Scoped Analysis: Use the games field to limit analysis to specific TCGs for faster and more accurate results.
Pricing
Vision is a premium API and costs 5 credits per request. Standard metadata requests typically cost 1 credit.

Response Timing
Vision analysis typically takes between 1-3 seconds depending on the image complexity and resolution.

Image Requirements
To ensure optimal performance and accuracy, please follow these guidelines:

File Size: Maximum allowed file size is 20MB.
Dimensions: We recommend images around 1500px to 2500px on the longest side.
Quality: Use high-quality, clear images with good lighting. While we support large files, highly optimized images (e.g., 200KB - 500KB) will be significantly more performant and reduce latency while maintaining high accuracy.
Format: We support common image formats including JPEG, PNG, and WebP.
Response Structure
data <object>

The root object containing the analysis and matches.

analysis <object>

The analysis of the image, including the type of card and any detected grading details.

type <string>: The type of card identified (e.g., "raw", "graded").
game <string>: The TCG the card belongs to (e.g., "pokemon").
language_code <string>: The detected language code of the card.
graded_details <object>: (Optional) If the card is graded, this contains:
company <string>: The grading company (e.g., "PSA").
grade_code <string>: The shorthand grade code (e.g., "GEM-MT").
grade_label <string>: The full grade label (e.g., "Gem Mint").
grade_number <string>: The numerical grade (e.g., "10").
year <string>: The year printed on the slab.
cert <string>: The certification number of the slab.
matches <array of objects>

A list of potential card matches found in our database, sorted by confidence score.

score <float>: The confidence score of the match. The confidence score is a combined index of visual similarity and data verification. It typically ranges from 0.7 to 1.3+. A higher score means the system is more certain because it found multiple matching signals on the card.
variant <string>: The detected variant of the card identified. Only provided if we have high confidence.
card <object>: The card object. This follows the same contract as our standard Card Objects.
page_size <integer>

The number of results returned per page.

count <integer>

The number of matches in the current response.

total_count <integer>

The total number of matches found.

Sample Acceptable Images
Raw Card Sample

Vision Raw Sample
Graded Card Sample

Vision Graded Sample
Sample Response
{
  "data": {
    "analysis": {
      "type": "graded",
      "game": "pokemon",
      "language_code": "EN",
      "graded_details": {
        "company": "PSA",
        "grade_code": "GEM-MT",
        "grade_label": "Gem Mint",
        "grade_number": "10",
        "year": "2026",
        "cert": "149202555"
      }
    },
    "matches": [
      {
        "score": 1.13252,
        "card": {
          "id": "me2pt5-284",
          "name": "Mega Gengar ex",
          "supertype": "Pokémon",
          "images": [
            {
              "type": "front",
              "small": "https://images.scrydex.com/pokemon/me2pt5-284/small",
              "medium": "https://images.scrydex.com/pokemon/me2pt5-284/medium",
              "large": "https://images.scrydex.com/pokemon/me2pt5-284/large"
            }
          ],
          "expansion": {
            "id": "me2pt5",
            "name": "Ascended Heroes"
          }
        }
      }
    ]
  }
}
Example Request
Lang:

NODE.JS
const axios = require('axios');

const identifyCard = async (imageUrl) => {
  const response = await axios.post('https://api.scrydex.com/vision/v1/cards/identify', {
    image_url: imageUrl,
    games: ['pokemon']
  }, {
    headers: {
      'X-Api-Key': 'YOUR_API_KEY',
      'X-Team-ID': 'YOUR_TEAM_ID'
    }
  });

  return response.data;
};
Identify via URL
Identifying a card via a public Image URL is the most efficient way to use the Vision API. Simply provide a link to the image, and our servers will fetch and analyze it.

Parameters
image_url <string>

The publicly accessible URL of the card image. Supported formats include JPEG, PNG, and WebP.

games <array>

An optional array of TCG identifiers to scope the search. Providing this can improve accuracy and speed.
Example: ["pokemon"]

Scoping by Game
The games field lets you scope the analysis to only certain TCGs. Valid options include: pokemon, lorcana, magicthegathering, onepiece, riftbound, and gundam.

If you only work with Pokémon cards, for example, it is better to just have pokemon there. It will default to all supported games if left unspecified.

Endpoint
POST /vision/v1/cards/identify

Request Body
{
  "image_url": "https://i.ebayimg.com/images/g/f7AAAeSwDgxp9s3N/s-l1600.jpg",
  "games": ["pokemon"]
}
Example Request
Lang:

NODE.JS
const axios = require('axios');

const identifyViaUrl = async (imageUrl) => {
  const response = await axios.post('https://api.scrydex.com/vision/v1/cards/identify', {
    image_url: imageUrl,
    games: ['pokemon']
  }, {
    headers: {
      'X-Api-Key': 'YOUR_API_KEY',
      'X-Team-ID': 'YOUR_TEAM_ID'
    }
  });

  return response.data;
};
Identify via File
If you have a local image file or a captured photo from a mobile device, you can upload it directly using a multipart/form-data request.

Parameters
image <file>

The binary image file to be analyzed. We recommend a resolution of at least 800x800 for optimal results.

games <string>

An optional string of comma-separated TCG identifiers to scope the search. Valid options include: pokemon, lorcana, magicthegathering, onepiece, riftbound, and gundam.

Mobile Best Practices
When capturing images on mobile devices, ensure the card is well-lit and fills most of the frame. Avoid glare on the card surface, especially for holographic or foil variants.

Sample Acceptable Images
Raw Card Sample

Vision Raw Sample
Graded Card Sample

Vision Graded Sample
Sample Response
{
  "data": {
    "analysis": {
      "type": "graded",
      "game": "pokemon",
      "language_code": "EN",
      "graded_details": {
        "company": "PSA",
        "grade_code": "GEM-MT",
        "grade_label": "Gem Mint",
        "grade_number": "10",
        "year": "2026",
        "cert": "149202555"
      }
    },
    "matches": [
      {
        "score": 1.13252,
        "card": {
          "id": "me2pt5-284",
          "name": "Mega Gengar ex",
          "supertype": "Pokémon",
          "images": [
            {
              "type": "front",
              "small": "https://images.scrydex.com/pokemon/me2pt5-284/small",
              "medium": "https://images.scrydex.com/pokemon/me2pt5-284/medium",
              "large": "https://images.scrydex.com/pokemon/me2pt5-284/large"
            }
          ],
          "expansion": {
            "id": "me2pt5",
            "name": "Ascended Heroes"
          }
        }
      }
    ]
  }
}
Example Request
Lang:

NODE.JS
const axios = require('axios');

const identifyCard = async (imageUrl) => {
  const response = await axios.post('https://api.scrydex.com/vision/v1/cards/identify', {
    image_url: imageUrl,
    games: ['pokemon']
  }, {
    headers: {
      'X-Api-Key': 'YOUR_API_KEY',
      'X-Team-ID': 'YOUR_TEAM_ID'
    }
  });

  return response.data;
};

Endpoint
POST /vision/v1/cards/identify

Request Body
{
  "image_url": "https://i.ebayimg.com/images/g/f7AAAeSwDgxp9s3N/s-l1600.jpg",
  "games": ["pokemon"]
}
Example Request
Lang:

NODE.JS
const axios = require('axios');

const identifyViaUrl = async (imageUrl) => {
  const response = await axios.post('https://api.scrydex.com/vision/v1/cards/identify', {
    image_url: imageUrl,
    games: ['pokemon']
  }, {
    headers: {
      'X-Api-Key': 'YOUR_API_KEY',
      'X-Team-ID': 'YOUR_TEAM_ID'
    }
  });

  return response.data;
};
Identify via File
If you have a local image file or a captured photo from a mobile device, you can upload it directly using a multipart/form-data request.

Parameters
image <file>

The binary image file to be analyzed. We recommend a resolution of at least 800x800 for optimal results.

games <string>

An optional string of comma-separated TCG identifiers to scope the search. Valid options include: pokemon, lorcana, magicthegathering, onepiece, riftbound, and gundam.

Mobile Best Practices
When capturing images on mobile devices, ensure the card is well-lit and fills most of the frame. Avoid glare on the card surface, especially for holographic or foil variants.

Endpoint
POST /vision/v1/cards/identify

Request Type
multipart/form-data

Form Data
image: [Binary File]
games: pokemon (Optional)
Example Request
Lang:

NODE.JS
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const identifyFile = async (filePath) => {
  const form = new FormData();
  form.append('image', fs.createReadStream(filePath));
  form.append('games', 'pokemon');

  const response = await axios.post('https://api.scrydex.com/vision/v1/cards/identify', form, {
    headers: {
      ...form.getHeaders(),
      'X-Api-Key': 'YOUR_API_KEY',
      'X-Team-ID': 'YOUR_TEAM_ID'
    }
  });

  return response.data;
};