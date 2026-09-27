<div dir="rtl">

# רנטגן למוקד · Call Center X-Ray

**אבחון תהליכים ואיתור הזדמנויות AI ואוטומציה: במוקד השירות ובארגון כולו, בעזרת Claude.**

שני מסלולים:
1. **ניתוח שיחות מוקד:** מתמלולים, נהלים ותצפיות אל מפת תהליך, הזדמנויות עם ציטוטים מאומתים וחיסכון בשקלים.
2. **מפת AI לארגון:** מיפוי תהליכים בכל המחלקות, ציון התאמה שקוף לכל תהליך, המלצה על סוג הפתרון ותוכנית הטמעה בשלושה גלים.

מכניסים תמלולי שיחות, נהלים והערות מישיבה ליד נציגים. הכלי מסתיר פרטים מזהים, מזהה מה קורה בשיחות, משרטט את התהליך כפי שהוא קורה בפועל, ומדרג איפה אוטומציה ו-AI יחסכו הכי הרבה זמן, בשקלים. כל ממצא מגיע עם ציטוט מהמקור, והכלי בודק אוטומטית שהציטוט באמת מופיע שם.

![הכלי בפעולה](docs/demo.gif)

> נתוני הדוגמה בריפו בדויים (מוקד תמיכה של ספק אינטרנט). הפרויקט אינו קשור לחברה מסוימת.

## למה זה קיים

הטמעת AI במוקד נכשלת בדרך כלל באחת משתי נקודות: בונים כלי לפני שמבינים איך העבודה נראית באמת, או שאי אפשר לסמוך על מה שהמודל אומר. הכלי בנוי סביב שלוש החלטות:

1. **קודם מבינים את התהליך, אחר כך בונים.** הקלט המרכזי הוא תצפית ותמלולים, והפלט הראשון הוא מפת התהליך בפועל ונקודות הכאב בה.
2. **פרטיות לפני הכול.** פרטים מזהים מוסתרים בדפדפן, לפני שהטקסט יוצא מהמחשב.
3. **אמון נמדד, לא מובטח.** כל טענה מגובה בציטוט שנבדק מול המקור, ויש מבחן דיוק מובנה.

## מה הכלי עושה

| שלב | מה קורה |
|---|---|
| **מקורות** | הדבקת טקסט, העלאת קבצים (‎.txt, ‎.csv, ‎.md, ‎.vtt ועוד), או ייבוא מסמכים מ-Google Drive |
| **הגנה על פרטיות** | הסתרה של ת.ז (כולל בדיקת ספרת ביקורת), טלפונים, כרטיסי אשראי (בדיקת Luhn), מיילים, IBAN ושמות, ורשימת מילים אישית. יש תצוגה מקדימה של מה שנשלח בפועל |
| **זיהוי** | סיבות פנייה וזמן טיפול לכל סוג, סנטימנט, חריגות מנוהל, ושאלות שחוזרות עם או בלי נוהל |
| **מפת תהליך** | התהליך לפי שחקנים (לקוח, נציג, מערכת, ראש צוות) ונקודות הכאב בו, עם מעבר בין לפני לאחרי והשוואת זמנים |
| **הזדמנויות** | מטריצת השפעה מול מאמץ, חישוב חיסכון (שיחות × אחוז מושפע × שניות × עלות שעה), שלבי יישום, כלים, מדדים וסיכונים |
| **ראיות** | ציטוט לכל ממצא, עם סימון "נמצא במקור ✓" או "לא נמצא מילה במילה", והקשר מסביב לציטוט |
| **פיילוט** | תוכנית של 4 עד 8 שבועות עם מדד הצלחה |
| **שאלו את האנליסט** | שיחת המשך שמבוססת על הניתוח בלבד |
| **מבחן דיוק** | סיווג שיחות מתויגות ומדידת accuracy, recall ו-precision, עם רשימת הטעויות |
| **מפת AI לארגון** | טבלת תהליכים לפי מחלקה עם שישה מדדים (חזרתיות, כללים, שפה, נתונים, שיקול דעת, רגישות), ציון היתכנות בנוסחה גלויה, חיסכון חודשי, המלצה (אוטומציה, סוכן AI, עוזר עם אישור אדם, תמיכה בהחלטה, קודם לסדר נתונים), מפת בועות של היתכנות מול חיסכון ותוכנית בשלושה גלים. אפשר לתאר את הארגון במילים ו-Claude יציע את רשימת התהליכים |
| **שיתוף** | דוח מנהלים של עמוד אחד (HTML), דוח מלא (Markdown), JSON, שמירה ב-Google Drive, טיוטת Gmail, וטיוטת workflow ל-n8n לכל הזדמנות |

![מפת AI לארגון](docs/screenshots/org-map.png)

## ארכיטקטורה

```mermaid
flowchart LR
  subgraph Browser["דפדפן (הכול רץ בצד הלקוח)"]
    S[מקורות<br/>טקסט · קבצים · Drive] --> R[הסתרת פרטים מזהים<br/>regex + ספרת ביקורת + Luhn]
    R --> P[בניית prompt<br/>סכמת JSON קבועה]
    V[אימות ציטוטים<br/>מול הטקסט שנשלח] --> UI[תצוגה<br/>מפות · מטריצה · ROI]
    UI --> X[ייצוא<br/>HTML · MD · JSON · n8n]
  end
  P --> L{{Claude<br/>דרך Claude או מפתח API}}
  L --> J[JSON מובנה<br/>+ ולידציה] --> V
  S -. ייבוא .-> GD[(Google Drive)]
  X -. שמירה .-> GD
  X -. טיוטה .-> GM[(Gmail)]
```

- **קובץ אחד, בלי שרת.** `index.html` אחד עם HTML, CSS ו-JavaScript. אין build ואין תלויות.
- **שכבת LLM מופשטת.** בתוך Claude הכלי משתמש ביכולת ה-`sample` של הדף, ובחיבורים ל-Drive ו-Gmail של המשתמש. מחוץ ל-Claude הוא קורא ישירות ל-Anthropic API עם מפתח שהמשתמש מזין, ששמור רק ב-sessionStorage.
- **פלט מובנה.** המודל מחזיר JSON לפי סכמה קבועה. הקוד מנקה ומגביל ערכים (effort ו-impact בין 1 ל-5, אחוזים בין 0 ל-100), ומחשב את החיסכון בעצמו ולא סומך על מספרים מהמודל.
- **אימות ציטוטים.** כל ציטוט מחופש בטקסט שנשלח בפועל, אחרי נרמול של רווחים ומירכאות. ציטוט שלא נמצא מסומן לבדיקה ידנית.

## הרצה

**1. בתוך Claude:** מפרסמים את `index.html` כ-Artifact עם היכולות `sample`, `downloads` ו-`mcp` (Google Drive, Gmail). הניתוח רץ על החשבון של המשתמש.

**2. GitHub Pages:** Settings ← Pages ← Deploy from branch ← `main` / root. פותחים את הקישור, מזינים מפתח API של Anthropic, ומריצים.

**3. מקומית:** פותחים את `index.html` בדפדפן. נתוני הדוגמה מוצגים גם בלי מפתח.

## מבחן דיוק משורת הפקודה

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
python eval/run_eval.py                        # מאגר הדמו המובנה (16 שיחות, 6 קטגוריות)
python eval/run_eval.py my_calls.csv --redact  # מאגר שלכם, עם הסתרת פרטים
```

הסקריפט מריץ את אותו סיווג כמו הכלי ומדפיס דיוק כולל, recall ו-precision לכל קטגוריה, ואת הטעויות. `dataset.csv` כולל שיחות דמו קצרות. על שיחות אמיתיות התוצאה יכולה להיות שונה, ולכן מריצים את המבחן גם עליהן.

## מבנה הריפו

```
index.html            הכלי עצמו (קובץ אחד)
eval/run_eval.py      מבחן דיוק משורת הפקודה
eval/dataset.csv      שיחות דמו מתויגות
samples/              מקורות הדמו: הערות תצפית, תמלולים, נוהל
docs/                 צילומי מסך ו-GIF
```

## מגבלות וכיוונים להמשך

- **תמלול:** הכלי מקבל טקסט. השלב הבא הוא תמלול הקלטות בעברית (Whisper או ivrit.ai) עם הפרדת דוברים.
- **Process mining:** מפת התהליך מבוססת היום על תמלולים ותצפית. חיבור ל-[PM4Py](https://github.com/process-intelligence-solutions/pm4py) על יומני אירועים מה-CRM ייתן מפה מבוססת נתוני מערכת.
- **הסתרת שמות:** זיהוי שמות מבוסס על ביטויים כמו "קוראים לי". זיהוי ישויות מלא בעברית (NER) ישפר אותו.
- **היקף:** ניתוח אחד מוגבל לכ-24 אלף תווים. למאגרים גדולים צריך ניתוח במנות וסיכום מדורג.
- **מספרים:** החיסכון הוא הערכה מתוך המקורות. ההזדמנויות חופפות בחלקן, ולכן הסכום הוא גבול עליון עד שמודדים בפיילוט.

## השראה והכרת תודה

- [CallLens](https://github.com/yablokolabs/CallLens): הרעיון שכל ציון מגובה בראיה מתוך השיחה.
- [mlrun/demo-call-center](https://github.com/mlrun/demo-call-center): הסתרת פרטים מזהים לפני ניתוח.
- [PM4Py](https://github.com/process-intelligence-solutions/pm4py): הכיוון להמשך בתחום ה-process mining.

## מחבר

**איליה נודלמן**: הטמעת פתרונות AI, הדרכה והובלת תהליכים, אוטומציה.

</div>

---

## English summary

**Call Center X-Ray** turns call transcripts, procedures and shadowing notes into a process diagnosis. It masks personal data in the browser, maps the as-is process by actor, ranks automation and AI opportunities by estimated monthly savings, and backs every finding with a quote that is automatically checked against the source text.

- Single-file web app (`index.html`), no build, no server. Runs inside Claude (Artifact with `sample`, `downloads`, `mcp`) or standalone with your own Anthropic API key.
- PII masking before anything leaves the browser: Israeli ID (checksum), phone, credit card (Luhn), email, IBAN, names after common phrases, custom terms.
- Structured JSON output with validation. ROI is computed in code: calls × affected share × seconds saved × hourly cost.
- Quote verification against the text actually sent, with as-is and to-be process maps.
- Built-in accuracy test (UI and `eval/run_eval.py`) with accuracy, per-label recall and precision.
- Exports: one-page executive report (HTML), full report (Markdown), JSON, Google Drive doc, Gmail draft, and an n8n workflow draft per opportunity.

- Organization-wide AI map: score any process on six criteria with a transparent formula, get a recommended solution type, a feasibility-vs-savings bubble map and a three-wave rollout plan; or describe the organization and let Claude propose the process inventory.

Demo data is fictional. MIT License.
