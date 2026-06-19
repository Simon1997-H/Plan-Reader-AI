# Intelligent Concrete Plan Reader

Open `index.html` in a browser.

## What it does

- Upload a PDF plan.
- Render PDF pages in the browser.
- Set scale by either drawing a grid/dimension arrow between two known points or entering a printed ratio such as `1:100` or `1/100`.
- Mark concrete works using rectangle, polygon, or wall-line tools.
- Mark whether the shape is regular, irregular/messy, curved, or assumed from tender notes.
- Add a quantity to repeated elements; if left blank the app uses quantity `1`.
- Use Pan Hand to drag around large drawings, or hold the mouse wheel button to temporarily pan while any markup tool is active.
- Mouse-wheel zoom works directly over the plan without changing measured scale.
- Classify each markup as slab, isolated footing, pad footing, wall, column/round, or beam.
- Calculate measured area, length, concrete volume, formwork area, waste allowance, and totals.
- Estimate reinforcement weight and steel price for each element.
- Choose one-way or two-way reinforcement for manual/minimum bar assumptions.
- Add dowels with bar diameter, length, embedment depth, spacing c/c, epoxy brand, and epoxy allowance.
- Include saw-cut length/rate for infill slab works and add saw-cut worker-days into manpower.
- Add minimum tools and equipment allowances including tie wire, small tools, and equipment wear/damage.
- Match reinforcement by tag if the uploaded PDF contains selectable schedule text such as `S1 SL82` or `F1 N12-200`.
- Use editable minimum reinforcement assumptions when no schedule/tag reinforcement is found.
- Estimate minimum manpower using editable concrete and reinforcement productivity assumptions.
- If a required parameter is missing, the app asks for it before saving the BOQ line.
- Export the BOQ as CSV.

## Reinforcement and manpower assumptions

The app is set up with editable defaults:

- Minimum slab assumption: N12 bars at 200 mm spacing, 1 layer.
- Non-slab fallback: 80 kg/m3.
- Common mesh weights are included for SL62, SL72, SL82, SL92, and SL102.
- Steel price default is an editable estimate. Update `$ / kg` to your supplier rate before relying on pricing.
- Minimum manpower uses concrete m3 per worker-day plus reinforcement kg per worker-day, then applies the minimum crew size.

## Market pricing

The app includes editable Australian market allowance fields for steel, concrete, formwork, and margin. A static GitHub Pages app cannot automatically scrape live supplier prices or commodity feeds. To keep steel price truly live, connect the app to a backend or pricing API. Until then, update the steel `$ / kg` field from your latest supplier quote or preferred Australian market source before issuing a quotation.

## Scale

Scale can be set in two ways:

- `Grid dimension`: enter the first grid name, second grid name, and real distance between them, choose metres or millimetres, then draw the scale arrow on the plan.
- `Plan ratio`: enter the printed plan scale as either `1:100` or `1/100`. Both formats are read the same way.

When a PDF has selectable text, the app also scans for printed scales automatically. Plan/floor/site scales are preferred over section/elevation/detail scales when both are shown. Section/detail scales remain available in the detected scale selector so they can be used separately when measuring sections. If a line scale has selectable numeric labels, the app attempts to set scale from that bar as well.

## Quotation

The quotation section calculates concrete, formwork, reinforcement, subtotal, safe margin, and suggested total. It also includes editable scope inclusions and exclusions. Once you upload the exact quotation form/template, the layout can be adjusted to mimic that form.

## Important limitation

This is an assisted intelligent plan reader, not a paid AI plan recognition service. It can extract concrete-related text from selectable PDF text, but scanned/image-only drawings need manual markup. Full automatic concrete detection from scanned construction plans requires an AI/OCR backend.

## Internet requirement

The app uses PDF.js from a CDN to render uploaded PDFs. It needs internet access when opening the app unless PDF.js is bundled locally in a later version.
