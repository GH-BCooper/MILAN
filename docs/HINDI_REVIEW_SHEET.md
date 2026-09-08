# Hindi Review Sheet — Tier 1, Item 3

**Purpose:** a native Hindi speaker verifies correctness/naturalness of every Hindi string
before the SIH demo. Read each item; mark ✅ correct or write the correction.

> ⚠️ The original recommendation said "12 Hindi reports" — the repo actually has **10**
Hindi reports plus **1** Santali report (in `seed-data/challenges.csv`). The other Devanagari
in the repo is **92 lines of Hindi keyword lexicon** in `lib/ai/gazetteer.ts` used for
domain classification + safety filtering (review those too — see B4).


## A. Seeded Hindi citizen reports (`seed-data/challenges.csv`, `body_original` where `body_lang=hi`)

Total: **10** (plus 1 Santali report, `body_lang=sat`). Only the original 7 are quoted below —
the three newer Hindi reports (school, power, solar) still need a reviewer pass. Re-seed after any edit: `pnpm seed --reset`

### A1. कोयल नदी के बांध में दरार बढ़ रही है
- **District/Block:** GUM / GUM-BAS
- **Domain:** WATER
- **Hindi (body_original):**

  > बसिया के पास कोयल नदी का जो मिट्टी का बांध है, उसमें पुलिया के पास बड़ी दरार आ गई है। पिछले बरसात के बाद से दरार हर महीने लंबी होती जा रही है। बारिश में पानी अगर इस दरार से घुसा तो पूरा टोला डूब जाएगा। हम लोग पत्थर डाल रहे हैं पर काम नहीं हो रहा।

- ✅ correct / ❌ correction: _____________________________________

### A2. सारे कुएं सूख गए, औरतें तीन किलोमीटर से पानी ला रही हैं
- **District/Block:** GAR / GAR-BHA
- **Domain:** WATER
- **Hindi (body_original):**

  > भंडरिया प्रखंड के हमारे गांव में मार्च से ही सारे कुएं और दो चापाकल सूख जाते हैं। औरतें और बच्चियां सुबह चार बजे उठकर तीन किलोमीटर दूर नाले से पानी लाती हैं। हर साल यही हाल है, पर इस साल जनवरी से ही कुआं खाली है। टैंकर कभी-कभी आता है। कोई ऐसा उपाय बताइए जिससे गांव का पानी गांव में रुके।

- ✅ correct / ❌ correction: _____________________________________

### A3. चांडिल डैम का पानी हर बरसात में गांव में घुस आता है
- **District/Block:** SKH / SKH-CHA
- **Domain:** WATER
- **Hindi (body_original):**

  > हम चांडिल डैम के किनारे बसे विस्थापित गांव के हैं। जब डैम का गेट खुलता है या पानी पीछे चढ़ता है तो हर साल अगस्त में हमारे खेत और घर के आंगन तक पानी आ जाता है। हमें कोई पहले से खबर नहीं देता, रात में पानी आता है। बुज़ुर्ग और बच्चे कैसे निकलें? कम से कम एक दिन पहले बताने का कोई तरीका होना चाहिए।

- ✅ correct / ❌ correction: _____________________________________

### A4. घर की दीवारों में दरार और ज़मीन से धुआँ निकल रहा है
- **District/Block:** DHN / DHN-JHA
- **Domain:** ENVIRONMENT
- **Hindi (body_original):**

  > झरिया में हमारा घर बीसीसीएल की पुरानी खदान के ऊपर है। पिछले साल से दीवारों में दरार आ रही है और आंगन में एक जगह से गर्म धुआँ निकलता है, रात में ज़मीन गर्म रहती है। पुनर्वास की लिस्ट में हमारा नाम कब आएगा पता नहीं। इस बीच हम कैसे जानें कि घर कब गिर सकता है? कोई नापने का तरीका हो तो बताइए।

- ✅ correct / ❌ correction: _____________________________________

### A5. पलामू में तीन साल से खरीफ की धान सूख रही है, मज़दूरी के लिए लोग बाहर जा रहे हैं
- **District/Block:** PAL / PAL-PAN
- **Domain:** AGRICULTURE
- **Hindi (body_original):**

  > पांकी के हमारे गांव में टांड़ ज़मीन ज़्यादा है। तीन साल से जुलाई में बारिश देर से आती है और सितंबर में रुक जाती है, धान की बाली आते-आते सूख जाती है। आधे घरों के जवान लड़के बाहर ईंट भट्ठे पर चले गए। कोई ऐसी खेती या बीज बताइए जो इस पानी में हो जाए, या पानी रोकने का ऐसा तरीका जो हम खुद बना सकें।

- ✅ correct / ❌ correction: _____________________________________

### A6. मनरेगा साइट पर दोपहर में मज़दूर बेहोश हो रहे हैं
- **District/Block:** PAL / PAL-MED
- **Domain:** HEALTHCARE
- **Hindi (body_original):**

  > मेदिनीनगर के आसपास अप्रैल-मई में दोपहर में तालाब खुदाई का काम चलता है। इस साल दो मज़दूर काम करते-करते गिर गए, एक की मौत सदर अस्पताल में हो गई। साइट पर न छाया है न ओआरएस। गर्मी कब जानलेवा होगी, यह पहले से कैसे पता चले और काम का समय कैसे बदले, यह कोई तय करे।

- ✅ correct / ❌ correction: _____________________________________

### A7. 2022 में स्वीकृत पीएमजीएसवाई सड़क आज तक नहीं बनी
- **District/Block:** CHA / CHA-KUN
- **Domain:** PUBLIC_SERVICE
- **Hindi (body_original):**

  > कुंदा प्रखंड में हमारे गांव तक की सड़क प्रधानमंत्री ग्राम सड़क योजना में 2022 में स्वीकृत हुई थी, बोर्ड भी लगा था। ठेकेदार ने आधा किलोमीटर मिट्टी डालकर काम छोड़ दिया। बीडीओ साहब को तीन बार आवेदन दिया, कोई जवाब नहीं। हम चाहते हैं कि जो सड़क मंज़ूर है वह बने और जिस ठेकेदार ने पैसा लिया उससे पूछा जाए।

- ✅ correct / ❌ correction: _____________________________________


## B. Hindi UI / prompt strings


### B1. Submit wizard — `app/(citizen)/submit/submit-wizard.tsx`

- (line 48) `"हमारे गाँव के ऊपर वाले बाँध में दरार आ गई है और बरसात में पानी रिसता है।",`
- (line 49) `"मार्च के बाद हमारा कुआँ सूख जाता है और औरतों को तीन किलोमीटर दूर से पानी लाना पड़ता है।",`
- (line 50) `"बरसात में नाले पर पुलिया न होने से गाँव का रास्ता छह हफ्ते बंद रहता है।",`
- (line 342) `<legend className="text-sm font-medium">Language / भाषा</legend>`
- (line 352) `{lang === "hi" ? "हिन्दी" : "English"}`
- (line 362) `अपने शब्दों में लिखें`
- (line 551) `<Label htmlFor="district">District / जिला</Label>`
- (line 569) `<Label htmlFor="block">Block / प्रखंड (optional)</Label>`
- (line 786) `["Language", state.bodyLang === "hi" ? "हिन्दी (Hindi)" : "English"],`


### B2. AI prompt P0 — `lib/ai/prompts/p0.ts`

- (line 43) `input: "कोयल नदी का जो मिट्टी का बांध है, उसमें पुलिया के पास बड़ी दरार आ गई है।",`
- (line 51) `input: "मनरेगा साइट पर दोपहर में मज़दूर बेहोश हो रहे हैं।",`


### B3. Rules provider — `lib/ai/providers/rules.ts`

- (line 216) `"है","हैं","का","की","के","को","में","से","पर","और","नहीं","कि","यह","वह","हम","एक","भी","तो","ही",`
- (line 275) `const first = base.split(/(?<=[.।!?])\s/)[0]?.trim() || base;`


### B4. Hindi keyword lexicon — `lib/ai/gazetteer.ts`  (92 Devanagari lines)

> NOT place-names — this is the Hindi keyword lexicon the AI pipeline uses for
> **domain classification** and **safety filtering** (e.g. `SELF_HARM`,
> `VIOLENCE_THREAT`, `बलात्कार`, `रिश्वत`, domain terms like `बांध`/`धान`/`बिजली`).
> A wrong or missing keyword here silently mis-routes or mis-classifies a real
> citizen report, so review spelling + diacritics carefully. (A few commented
> English↔Hindi pairs are reference examples, not live strings.)

```
{ term: "आत्महत्या", category: "SELF_HARM" },
{ term: "जान दे दूंगा", category: "SELF_HARM" },
{ term: "जान से मार", category: "VIOLENCE_THREAT" },
{ term: "बम", category: "VIOLENCE_THREAT" },
{ term: "बलात्कार", category: "SEXUAL_VIOLENCE" },
{ term: "तस्करी", category: "CHILD_SAFETY" },
{ term: "डायन", category: "TARGETED_HARASSMENT" },
{ term: "स्वीकृत", weight: 0.35 },
{ term: "नहीं बनी", weight: 0.3 },
{ term: "नहीं बना", weight: 0.3 },
{ term: "लगा दिया गया", weight: 0.25 },
{ term: "पीएमजीएसवाई", weight: 0.3 },
{ term: "जल जीवन", weight: 0.3 },
{ term: "पेंशन नहीं", weight: 0.4 },
{ term: "राशन कार्ड", weight: 0.3 },
{ term: "रिश्वत", weight: 0.4 },
{ term: "ठेकेदार", weight: 0.2 },
{ term: "शिकायत", weight: 0.15 },
{ term: "योजना", weight: 0.15 },
{ term: "दरार", weight: 0.2 },
{ term: "कटाव", weight: 0.25 },
{ term: "धंस", weight: 0.3 },
{ term: "सूख", weight: 0.2 },
{ term: "हाथी", weight: 0.25 },
{ term: "लू", weight: 0.2 },
{ term: "आग", weight: 0.15 },
{ term: "रिस", weight: 0.2 },
* "pmgsy" and "स्वीकृत", the Jal Jeevan taps carry "jal jeevan" and "were fitted".
"sanctioned", "स्वीकृत", "swikrit", "tender was passed", "निविदा",
"pmgsy", "पीएमजीएसवाई", "jal jeevan", "जल जीवन", "mgnrega payment",
"pension has not", "पेंशन नहीं", "ration card", "राशन कार्ड",
"bribe", "रिश्वत", "contractor took",
"not been built", "not built", "नहीं बनी", "नहीं बना",
if (/pension|राशन|ration|मनरेगा|mgnrega/.test(t)) return "JharSewa";
if (/pmgsy|पीएमजीएसवाई|jal jeevan|जल जीवन|road|सड़क/.test(t)) return "CPGRAMS";
{ term: "बांध", domain: "WATER", weight: 0.9 },
{ term: "बाँध", domain: "WATER", weight: 0.9 },
{ term: "नदी", domain: "WATER", weight: 0.6 },
{ term: "कुआं", domain: "WATER", weight: 0.7 },
{ term: "कुएं", domain: "WATER", weight: 0.7 },
{ term: "कुँआ", domain: "WATER", weight: 0.7 },
{ term: "चापाकल", domain: "WATER", weight: 0.7 },
{ term: "पानी", domain: "WATER", weight: 0.5 },
{ term: "डैम", domain: "WATER", weight: 0.7 },
{ term: "नहर", domain: "WATER", weight: 0.6 },
{ term: "फ्लोराइड", domain: "HEALTHCARE", weight: 1.0 },
{ term: "दस्त", domain: "HEALTHCARE", weight: 0.8 },
{ term: "बेहोश", domain: "HEALTHCARE", weight: 0.9 },
{ term: "अस्पताल", domain: "HEALTHCARE", weight: 0.7 },
{ term: "बीमार", domain: "HEALTHCARE", weight: 0.5 },
{ term: "धान", domain: "AGRICULTURE", weight: 0.9 },
{ term: "खरीफ", domain: "AGRICULTURE", weight: 0.9 },
{ term: "फसल", domain: "AGRICULTURE", weight: 0.7 },
{ term: "खेत", domain: "AGRICULTURE", weight: 0.6 },
{ term: "हाथी", domain: "AGRICULTURE", weight: 0.5 },
{ term: "सिंचाई", domain: "AGRICULTURE", weight: 0.6 },
{ term: "धंस", domain: "ENVIRONMENT", weight: 0.9 },
{ term: "खदान", domain: "ENVIRONMENT", weight: 0.7 },
{ term: "खान", domain: "ENVIRONMENT", weight: 0.5 },
{ term: "धुआँ", domain: "ENVIRONMENT", weight: 0.7 },
{ term: "धुआं", domain: "ENVIRONMENT", weight: 0.7 },
{ term: "धूल", domain: "ENVIRONMENT", weight: 0.7 },
{ term: "प्रदूषण", domain: "ENVIRONMENT", weight: 0.7 },
{ term: "जंगल", domain: "ENVIRONMENT", weight: 0.5 },
{ term: "लाह", domain: "LIVELIHOODS", weight: 0.8 },
{ term: "महुआ", domain: "LIVELIHOODS", weight: 0.6 },
{ term: "पलायन", domain: "LIVELIHOODS", weight: 0.8 },
{ term: "मज़दूरी", domain: "LIVELIHOODS", weight: 0.5 },
{ term: "स्कूल", domain: "EDUCATION", weight: 0.8 },
{ term: "विद्यालय", domain: "EDUCATION", weight: 0.8 },
{ term: "आंगनबाड़ी", domain: "EDUCATION", weight: 0.7 },
{ term: "शिक्षक", domain: "EDUCATION", weight: 0.7 },
{ term: "शौचालय", domain: "SANITATION", weight: 0.9 },
{ term: "नाली", domain: "SANITATION", weight: 0.6 },
{ term: "कचरा", domain: "SANITATION", weight: 0.7 },
{ term: "पुलिया", domain: "ACCESSIBILITY", weight: 0.6 },
{ term: "पुल", domain: "ACCESSIBILITY", weight: 0.7 },
{ term: "रास्ता", domain: "ACCESSIBILITY", weight: 0.5 },
{ term: "कॉलोनी", domain: "URBAN_INFRA", weight: 0.6 },
{ term: "जलजमाव", domain: "URBAN_INFRA", weight: 0.8 },
{ term: "नगर निगम", domain: "URBAN_INFRA", weight: 0.7 },
{ term: "जल जीवन", domain: "PUBLIC_SERVICE", weight: 0.8 },
{ term: "पेंशन", domain: "PUBLIC_SERVICE", weight: 0.8 },
{ term: "राशन", domain: "PUBLIC_SERVICE", weight: 0.7 },
"पक्की सड़क",
"पुल बनवा",
"निविदा",
```