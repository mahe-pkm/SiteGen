# Business-First Design Preview

This is an isolated, static design proposal, not a deployed business website or a
replacement for existing generated releases. It uses the fictional Willow
Gatherings brief already present in Proto_1. No Google data, ratings, customer
quotes, completed-project claims, real contact destinations, or API keys are
included. The enquiry form only renders a local summary and never sends/stores it.

## Assets

Illustrative photography downloaded from Unsplash, not a business portfolio:

- Hero/floral table: https://images.unsplash.com/photo-1511795409834-ef04bbd61622
- Ballroom: https://images.unsplash.com/photo-1519167758481-83f550bb49b3
- Table styling: https://images.unsplash.com/photo-1519225421980-715cb0215aed
- License checked: https://unsplash.com/license

DM Sans and DM Serif Display are self-hosted from Google Fonts. Icons are generated
from the installed lucide-react library, not manually drawn. Optimized WebP
photos, fonts and icons are included in the repository. Duplicate source JPEGs
and the one-off asset-preparation script are local-only and are not required
to run, test or build the application.
All runtime assets are local; opening index.html directly also works.
Font OFL licenses and the Lucide license are included in the assets directory.

## Integration Status

The approved direction is integrated as the separate Signature template in
`templates/signature.hbs`, with its own runtime and stylesheet additions. This
original proposal remains unchanged. Signature supports independently supplied
short branding, logo, hero and gallery uploads; reviewed section copy; separate
live Google supporting sections; and locally composed enquiries. Existing saved
sites remain on their original templates until explicitly edited.

Google display requirements were checked against:
https://developers.google.com/maps/documentation/places/web-service/policies

## Real Business Checklist

- Add as a separate template, retaining Events/Atelier/Local and prior releases.
- Bind hero/header to independently supplied short brand name and logo.
- Bind service descriptions, FAQs and about copy to reviewed independent content.
- Use business-owned photography for the hero and primary portfolio.
- Keep any Google content in its own supporting components with compliant
  attribution, source access and photo/review author information. No attribution
  is being removed from existing Google-backed previews by this proposal.
- Connect a real, owner-approved enquiry destination before public publication.
- Preserve the current local-only deployment boundary.
