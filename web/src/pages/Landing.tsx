import { Link } from 'react-router-dom'
import { SwingingTag } from '../components/illustrations'
import { Reveal, RevealOnScroll, Stagger, StaggerItem } from '../components/motion'
import { TagArt } from '../components/TagArt'
import type { DesignSpec } from '../api/client'
import { FALLBACK_DESIGN } from '../lib/design'

/** Three sample designs, so the page shows the idea rather than describing it. */
const SAMPLES: {
  design: DesignSpec
  name: string
  caption: string
  icon: string
  iconColor: string
}[] = [
  {
    design: { ...FALLBACK_DESIGN, motif: 'weave', palette: 'forest' },
    name: 'R. Fernandez',
    caption: 'Forest weave',
    icon: 'roller',
    iconColor: 'forest',
  },
  {
    design: {
      ...FALLBACK_DESIGN,
      motif: 'dot',
      palette: 'brick',
      field: '#F7EDE9',
      ink: '#9C3B2A',
      accent: '#2F5D4E',
      accent_band: true,
    },
    name: 'A. Okafor',
    caption: 'Brick dot',
    icon: 'duffel',
    iconColor: 'brick',
  },
  {
    design: {
      ...FALLBACK_DESIGN,
      motif: 'diagonal',
      palette: 'brass',
      field: '#F6EFDE',
      ink: '#8C6221',
      accent: '#1F4034',
      angle: 60,
    },
    name: 'M. Laurent',
    caption: 'Brass diagonal',
    icon: 'backpack',
    iconColor: 'brass',
  },
]

export function Landing() {
  return (
    <div className="page">
      <section className="wrap grid grid--split" style={{ paddingTop: 32, paddingBottom: 56 }}>
        <Reveal>
          <p className="kicker">a product concept, built</p>
          <h1>
            Spot your bag in a second.
            <br />
            Share your <em style={{ color: 'var(--forest)' }}>name</em>, not your address.
          </h1>
          <p className="lede" style={{ marginTop: 18 }}>
            Every traveller gets one unique design across all their luggage — and a QR code that
            stays private until the bag is actually lost.
          </p>
          <div className="row" style={{ marginTop: 26 }}>
            <Link to="/register" className="btn btn--primary">
              Create an account
            </Link>
            <Link to="/login" className="btn btn--ghost">
              Sign in
            </Link>
          </div>
        </Reveal>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 210 }}>
            <SwingingTag delay={0.2}>
              <TagArt
                design={SAMPLES[0]!.design}
                name="R. Fernandez"
                subtitle="Terminal 3 · Gate B12"
                icon={SAMPLES[0]!.icon}
                iconColor={SAMPLES[0]!.iconColor}
              />
            </SwingingTag>
          </div>
        </div>
      </section>

      <hr className="rule" />

      <section className="wrap" style={{ paddingBottom: 56 }}>
        <RevealOnScroll>
        <p className="kicker">the tag</p>
        <h2>One design, generated once — used on every bag you own.</h2>
        <p className="lede" style={{ marginTop: 14 }}>
          The pattern and colour are tied to the traveller, not the suitcase. A carry-on, a duffel
          and a hard-shell case all wear the same mark, so the eye learns to find it fast on a
          crowded belt.
        </p>
        </RevealOnScroll>
        <Stagger className="grid grid--3" style={{ marginTop: 36 }} onScroll>
          {SAMPLES.map((sample) => (
            <StaggerItem key={sample.caption}>
              <figure className="tag-card lift" style={{ margin: 0 }}>
                <TagArt
                  design={sample.design}
                  name={sample.name}
                  subtitle="One design, every bag"
                  icon={sample.icon}
                  iconColor={sample.iconColor}
                />
                <figcaption className="faint center">{sample.caption}</figcaption>
              </figure>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <hr className="rule" />

      <section className="wrap" style={{ paddingBottom: 56 }}>
        <RevealOnScroll>
        <p className="kicker">how it works</p>
        <h2>From sign-up to a found bag, in four steps.</h2>
        </RevealOnScroll>
        <Stagger className="grid grid--4" style={{ marginTop: 32 }} onScroll>
          {[
            ['1', 'Create a profile', 'Name, phone, email. Everything is encrypted before it is stored.'],
            ['2', 'Get your design', 'A unique pattern and QR code, ready to print at the exact tag size.'],
            ['3', 'Someone scans it', 'They see a status page. No account needed. Location sharing is optional.'],
            ['4', 'You decide what is shown', 'Mark the bag lost, and your name and a contact option appear. Otherwise, nothing does.'],
          ].map(([num, title, body]) => (
            <StaggerItem key={num}>
              <div
                className="mono"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  border: '1px solid var(--brass)',
                  color: 'var(--brass)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 14,
                  background: 'var(--white)',
                }}
              >
                {num}
              </div>
              <h3 style={{ fontSize: 17, marginBottom: 6 }}>{title}</h3>
              <p className="muted" style={{ fontSize: 14.5 }}>
                {body}
              </p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <hr className="rule" />

      <section className="wrap" style={{ paddingBottom: 56 }}>
        <RevealOnScroll>
        <p className="kicker">privacy, by default</p>
        <h2>The QR code carries a token. Never your data.</h2>
        <p className="lede" style={{ marginTop: 14 }}>
          Scanning a tag never exposes raw information — it opens a page that decides what to show,
          based on rules you control.
        </p>
        </RevealOnScroll>
        <Stagger className="grid grid--2" style={{ marginTop: 32 }} onScroll>
          {[
            [
              'Encrypted with a key of your own',
              'Every account has its own data key. Your name, phone and address are sealed with it, and deleting your account destroys that key for good.',
            ],
            [
              'The QR holds a random ID',
              'Not your name or number — just a 256-bit token the server uses to look up what is allowed to be shown.',
            ],
            [
              'Contact stays masked',
              'Messages route through the app. A finder can reach you without ever seeing your phone number or email.',
            ],
            [
              'Location logs expire',
              'Scan history is kept only as long as it is useful, then deleted automatically. The finder’s address is never stored at all.',
            ],
          ].map(([title, body]) => (
            <StaggerItem className="card" key={title}>
              <h3 style={{ fontSize: 16.5, marginBottom: 8 }}>{title}</h3>
              <p className="muted" style={{ fontSize: 14.5, margin: 0 }}>
                {body}
              </p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="wrap" style={{ paddingBottom: 24 }}>
        <RevealOnScroll className="card center" style={{ padding: 36 }}>
          <h2 style={{ marginBottom: 10 }}>Start with one tag.</h2>
          <p className="muted" style={{ maxWidth: '46ch', margin: '0 auto 20px' }}>
            Print it yourself at the exact size your supplier asks for, or run the whole thing on
            your own infrastructure — the code is AGPL-3.0.
          </p>
          <Link to="/register" className="btn btn--primary">
            Create an account
          </Link>
        </RevealOnScroll>
      </section>
    </div>
  )
}
