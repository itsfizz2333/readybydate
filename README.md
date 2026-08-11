# ReadyByDate.com

A professional, customer-friendly production timeline calculator. ReadyByDate.com
turns sample, approval, production, and shipping lead times into a clear English
timeline with an estimated in-hands date.

## First-version features

- Flexible production steps with editable names, order, and lead times
- One to four sample rounds
- Physical-sample or photo approval for each round
- Customer approval dates automatically moved off weekends
- Editable air, fast sea, and standard sea transit times
- One or more parallel shipping options with separate in-hands dates
- Automatic browser-local saving and recovery of timeline settings
- Copy, CSV export, and print/PDF output
- Customer timeline paste analysis
- US short-date support such as `8/11`, using the current year by default
- Responsive desktop and mobile layout

## Current planning assumptions

- All durations are calendar days.
- The starting day is not counted.
- Saturday and Sunday still count inside a stage duration.
- Customer approval milestones move from Saturday or Sunday to the next Monday.
- A weekend adjustment becomes the starting point for every following stage.
- Public holidays are not included in version 1.

The default stages and lead times are provisional until they are matched against
the source Excel calculator.

## Local development

Node.js `>=22.13.0` is required.

```bash
npm install
npm run dev
npm test
```

`npm run build` creates the production build. `npm run lint` checks the source.

## Data behavior

The current version does not require sign-in and does not send calculations to a
server. Timeline settings are stored only in the current browser profile.
Clearing site data, using private browsing, or changing devices removes access to
that saved calculation.
