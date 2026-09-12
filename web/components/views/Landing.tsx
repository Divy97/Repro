/**
 * The one page whose job is persuasion rather than instrumentation — and, since 10o, the
 * one page that has to be legible to somebody who has never heard of any of this.
 *
 * The previous draft argued correctly and read like a memo. Every paragraph was set in
 * `--muted`, every section wore the same 0.68rem uppercase label, and the sentences ran
 * three clauses deep. A reader already inside the product could follow it; a first-time
 * visitor met roughly seven hundred words of undifferentiated grey and no way to tell
 * which sentence was the point. That is a comprehension bug, not a taste one.
 *
 * What changed:
 *
 *   - SECTION HEADINGS ARE HEADINGS. They were mono eyebrows whispering at 0.68rem, which
 *     is the size of a caption. A first-time reader scans headings and nothing else, so
 *     the headings now carry the argument on their own: read only the `h2`s and you know
 *     what this does, what it refuses, and where your code runs.
 *   - PROSE IS SET IN `--ink`. `--muted` is for captions and machine metadata. Body text
 *     in it is a readability tax paid on every paragraph of the only public page.
 *   - THE SHAPE IS SHOWN BEFORE IT IS EXPLAINED. `.flow` is three panels — what you hand
 *     over, what happens, what you get back — in the product's own mono. It is the first
 *     thing below the headline because it is the only thing a visitor needs to understand
 *     before deciding whether to read further.
 *   - THE WORDS ARE DEFINED. `base commit`, `sealed container`, `exit code` and `tier` are
 *     the page's whole vocabulary and four of them are jargon. They now have a glossary
 *     rather than an assumption.
 *
 * What did NOT change is the constraint that makes this page worth anything: no logo
 * wall, no invented user count, no testimonial. A product arguing that a claim without
 * evidence is worth nothing cannot open with one. Every number below is one the engine
 * actually produces.
 *
 * NOT a client component, and that is deliberate. This is the markup Next pre-renders into
 * `index.html` at build time, which is the one document a crawler, a link preview or a
 * reader with JavaScript disabled ever receives. Everything else in this bundle needs the
 * browser; this needs to work without it.
 */

/**
 * The header, exported separately so `page.tsx` can render it OUTSIDE `<main>` — for the
 * same reason the footer is. A `banner` landmark nested inside `main` is either flagged by
 * every audit tool or dropped entirely, depending on the browser's mapping.
 *
 * The link here is the SAME door as the hero's, not a second one: same label, same
 * destination. ONE CALL (10n) is a rule about how many different things a visitor is asked
 * to choose between, and this asks for none — it is the one call, kept in reach after the
 * hero has scrolled away. It deliberately does not wear `.cta`; the page has exactly one
 * of those and the tests count them.
 */
export function LandingHeader({ installUrl, signIn }: { installUrl: string; signIn: boolean }) {
  return (
    <header className="lander-top">
      <div>
        <a className="wordmark" href="/">
          <span className="wordmark-name">Repro</span>
          <span className="wordmark-tag">reproduce first</span>
        </a>
        {/*
          IN-PAGE ANCHORS, not a second door. This page is eight sections and about two
          screens of scrolling per section, and the header was a brand and a button with
          a thousand pixels of nothing between them. A reader who wants to know what it
          refuses to do, or what a word means, had to scroll and hope.

          Three, not eight: the ones a first-time visitor actually goes looking for.
          `html` already carries `scroll-padding-top`, so a target lands clear of this bar
          rather than under it.
        */}
        <nav className="lander-nav" aria-label="On this page">
          <a href="#how-h">How it works</a>
          <a href="#not-h">What it won&rsquo;t do</a>
          <a href="#words-h">Glossary</a>
        </nav>
        {signIn ? (
          <a className="top-call" href="/auth/github">
            Continue with GitHub
          </a>
        ) : (
          <a className="top-call" href={installUrl}>
            Install on GitHub
          </a>
        )}
      </div>
    </header>
  );
}

export function Landing({ installUrl, signIn }: { installUrl: string; signIn: boolean }) {
  return (
    <>
      <section className="hero-band" aria-labelledby="hero-h">
        <div className="hero-grid">
          <div className="hero-say">
            <p className="eyebrow">Reproduce · Fix · Prove</p>
            {/*
              The headline said "proves the bug existed", which describes a third of what
              happens and the least useful third. Reproducing is the PRECONDITION; the
              deliverable is a fix, and the reason to trust it is that the same run proves
              it with commands it executed itself.

              The lede opened "Not a coding agent" — defining the product by negation
              before the reader knows what it is, and picking a fight in the first four
              words.
            */}
            <h1 className="display" id="hero-h">
              <span className="display-a">Open an issue.</span>{' '}
              <span className="display-b">
                Get a pull request that fixes the bug and proves the fix.
              </span>
            </h1>
            {/*
              SHORTER SENTENCES, PLAINER WORDS. This was four clause-heavy sentences
              carrying "base commit", "sealed container", "exit codes rather than
              adjectives" — three pieces of vocabulary in the first paragraph a stranger
              reads. The vocabulary is still on the page; it is just no longer the price of
              admission. The refusal stays here, above the fold, because it is the
              differentiator and it used to be a card five sections down.
            */}
            <p className="lede">
              First it makes your bug happen — on your code, in a locked box with no way
              out to the internet. Then it writes the fix. Then it runs the tests on the
              code before and after, and shows you what they printed.{' '}
              <b>If it cannot reproduce your bug, it opens nothing</b> — you get a question
              back, not a patch to review.
            </p>
            {/*
              ONE DOOR (10n). This was two CTAs of near-equal weight — `Install on GitHub`
              primary, `Sign in` secondary — and they are not alternatives. Both are
              required, in sequence, and every order dead-ends: install first and GitHub
              returns you here with no session, still looking at the landing page; sign in
              first and Repositories says nothing is connected.

              So signing in is the only call. It works from every state a visitor can be
              in: never installed, installed already, or coming back. Afterwards the app
              KNOWS which, and can name the one next thing instead of offering a menu —
              which is also where installing belongs, on the Repositories page that can see
              whether anything is connected.
            */}
            <p className="calls">
              {signIn ? (
                <a className="cta" href="/auth/github">
                  Continue with GitHub
                </a>
              ) : (
                // No accounts on this deployment — `serve.ts`, one operator on 127.0.0.1.
                // There is nothing to sign in to, so installing IS the way in.
                <a className="cta" href={installUrl}>
                  Install on GitHub
                </a>
              )}
              <span className="calls-note">
                {signIn ? (
                  <>Takes about a minute. Nothing is read until you pick a repository.</>
                ) : (
                  <>Grants access to the repositories you pick, and nothing else.</>
                )}
              </span>
            </p>
          </div>

          {/*
            THE SHAPE, BEFORE THE ARGUMENT.

            Three panels: what you hand over, what happens to it, what comes back. It is
            the first thing under the headline because a visitor who cannot picture the
            shape of the thing has no reason to read the six sections that justify it —
            and the old page's first concrete object was a 90/103 score, which is a number
            about a thing the reader had not been shown yet.

            The arrows are `aria-hidden`: the DOM order already says "you give, it works,
            you get", and a screen reader announcing "right arrow" twice adds nothing.
          */}
          <div className="flow" role="group" aria-label="What goes in, and what comes back">
            <div className="flow-cell">
              <p className="flow-label">You hand over</p>
              <p className="flow-fact">acme/checkout#41</p>
              <p className="flow-say">&ldquo;Totals are wrong when a coupon is applied.&rdquo;</p>
            </div>
            <div className="flow-arrow" aria-hidden="true">
              →
            </div>
            <div className="flow-cell">
              <p className="flow-label">It runs</p>
              <p className="flow-fact">sealed container</p>
              <p className="flow-say">Your code, your tests, no network. Destroyed afterwards.</p>
            </div>
            <div className="flow-arrow" aria-hidden="true">
              →
            </div>
            <div className="flow-cell out">
              <p className="flow-label">You get back</p>
              <p className="flow-fact">pull request + proof</p>
              <p className="flow-say">The fix, and the commands that show it works.</p>
            </div>
          </div>
        </div>
      </section>

      {/*
        THE WHOLE ARGUMENT IN THREE LINES, for the reader who will not get further.

        This band did not exist. The page went from the headline into a five-section
        breakdown of a pull request, which is detail before thesis. These are the three
        claims everything below is evidence for, at a size that can be read at a glance.
      */}
      <section className="band claims" aria-labelledby="claims-h">
        <div>
          <h2 className="band-head" id="claims-h">
            It proves three things, in this order
          </h2>
          <ol className="claim-list">
            <li>
              <p className="claim">The bug is real.</p>
              <p className="claim-why">
                It reproduces the failure on your code <i>before</i> it writes a line of the
                fix. No reproduction, no pull request.
              </p>
            </li>
            <li>
              <p className="claim">The fix works.</p>
              <p className="claim-why">
                It writes a test that fails because of the bug, then shows that same test
                passing once the fix is in.
              </p>
            </li>
            <li>
              <p className="claim">Nothing else broke.</p>
              <p className="claim-why">
                It runs your own test suite on the code before the fix and the code after,
                and shows you both results.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/*
        WHAT YOU GET, before how it is scored. The deliverable is a pull request, its five
        sections are fixed and written from the log rather than from anybody's summary
        (`src/report.ts`), and showing them is both concrete and the strongest argument the
        product has.
      */}
      <section className="band lead" aria-labelledby="pr-h">
        <div>
          <h2 className="band-head" id="pr-h">
            What lands in your pull request
          </h2>
          <p className="band-say">
            Five sections, always all five, always in this order. Written from what the run
            actually did.
          </p>
          <div className="specimen">
            <div className="specimen-bar">
              <span className="mono">acme/checkout#41</span>
              <span className="muted">the description, in full</span>
            </div>
            <div className="specimen-body">
              <ol className="doc">
                <li>
                  <b>The bug</b>
                  <span>Your report, quoted, so the claim being tested is on the page.</span>
                </li>
                <li>
                  <b>The failing test</b>
                  <span>
                    The command that reproduces it — registered before the fix agent
                    existed, so it cannot have been written to suit the fix.
                  </span>
                </li>
                <li>
                  <b>Base red, fix green</b>
                  <span>
                    A table of commits, exit codes and the symptom found in the output. Each
                    line is a file you can open.
                  </span>
                </li>
                <li>
                  <b>The diff</b>
                  <span>Every file touched, and the full patch.</span>
                </li>
                <li>
                  <b>The tier reached</b>
                  <span>How far the evidence actually goes — including what was not measured.</span>
                </li>
              </ol>
            </div>
          </div>
          <p className="muted small">
            A description that drops the tier when the tier is awkward is a description you
            have to check by hand, which is the job this is supposed to do for you.
          </p>
        </div>
      </section>

      <section className="band" aria-labelledby="tier-h">
        <div>
          <h2 className="band-head" id="tier-h">
            Every point is an exit code, not an opinion
          </h2>
          <p className="band-say">
            A run is scored out of 103. Points come from commands this engine ran and kept
            the output of. Here is a real one.
          </p>
          <div className="specimen">
            <div className="specimen-bar">
              <span className="mono">run 7f3a91c4</span>
              <span className="mono">acme/checkout#41</span>
              <span className="stamp">Tier 2 — reproduced</span>
            </div>
            <div className="specimen-body">
              <p className="verdict">
                <span className="n">+40</span> the reported symptom was reproduced on the base commit
                <br />
                <span className="n">+30</span> a failing test the agent wrote, passing after the fix
                <br />
                <span className="n">+20</span> your own suite ran green on both commits
                <br />
                <span className="n">&nbsp;&nbsp;+0</span>{' '}
                <span className="muted">the agent said it was confident</span>
                <br />
                <span className="n total">90/103</span> <b>evidence, not testimony</b>
              </p>
            </div>
          </div>
          <p className="muted small">
            Note the fourth line. The agent&rsquo;s own confidence is worth <b>nothing</b>. It
            is stored and shown to you anyway, because you may want to read it — but no
            verdict here rests on anything the model said about itself.
          </p>
        </div>
      </section>

      <section className="band" aria-labelledby="how-h">
        <div>
          <h2 className="band-head" id="how-h">
            How a run goes
          </h2>
          <div className="steps">
            <div className="step">
              <div>
                <h3>You pick an issue and press Start</h3>
                <p>
                  You choose which repositories to connect, and which bug to work on. You are
                  never asked for a personal access token.
                </p>
              </div>
            </div>
            <div className="step">
              <div>
                <h3>It reproduces the bug — or it stops</h3>
                <p>
                  On your code, in a container with no network at all, not even DNS. If it
                  cannot make your bug happen, it stops here and asks you what it is missing.
                  It does not guess at a fix for a bug it never saw.
                </p>
              </div>
            </div>
            <div className="step">
              <div>
                <h3>It writes the fix, then checks it twice</h3>
                <p>
                  Once, that the reproduction now passes — the reported bug is gone. Again,
                  that your own test suite still passes on the code before and after —
                  nothing else went with it.
                </p>
              </div>
            </div>
            <div className="step">
              <div>
                <h3>You watch, then you decide</h3>
                <p>
                  Every command, exit code and file streams to you as it happens, and is kept
                  afterwards. It opens the pull request. You merge it, or you do not.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="not-h">
        <div>
          <h2 className="band-head" id="not-h">
            Four things it will not do
          </h2>
          <div className="cards">
            <div className="card">
              <h3>It will not fix what it cannot reproduce</h3>
              <p>
                No reproduction means no pull request — not a smaller one, not a hedged one.
                A bug nobody can make happen is a question, and you get the question back.
              </p>
            </div>
            <div className="card">
              <h3>It will not call one green test a fix</h3>
              <p>
                A passing test proves that test passes. Your whole suite, on the code before
                and the code after, is what shows the fix did not cost you something else.
              </p>
            </div>
            <div className="card">
              <h3>It will not take the model&rsquo;s word for anything</h3>
              <p>
                What the agent says about its own work is kept and shown to you, and counts
                towards no verdict. Only exit codes and stored output do.
              </p>
            </div>
            <div className="card">
              <h3>It will not merge</h3>
              <p>
                It opens the pull request and stops. Every decision after that is yours, and
                the evidence is sitting there to make it with.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="safe-h">
        <div>
          <h2 className="band-head" id="safe-h">
            Where your code runs, and what it can reach
          </h2>
          <div className="safe">
            <p>
              On repositories you pick, one at a time, in a container that is destroyed when
              the run ends. Installing grants access to those repositories and nothing else.
            </p>
            <p>
              <b>Your credentials are never in there with the agent.</b> The container holds
              no model key and no GitHub token. The loop runs outside it and passes tool
              calls in, so the sandbox needs no way out to the network and is given none.
            </p>
            <p>
              Every container is probed from the inside to prove the seal held, and the run
              says so in its own log rather than asking you to assume it.
            </p>
          </div>
        </div>
      </section>

      {/*
        THE GLOSSARY, which is the cheapest comprehension fix on the page.

        Four terms carry the entire argument above and all four are jargon to the visitor
        this page is for. Previously they were used unglossed from the first paragraph
        onward, which quietly sorted readers into people who already knew and people who
        guessed.
      */}
      <section className="band words" aria-labelledby="words-h">
        <div>
          <h2 className="band-head" id="words-h">
            The four words this page leans on
          </h2>
          <dl className="glossary">
            <div>
              <dt>Base commit</dt>
              <dd>
                Your code exactly as it is today, before anything is changed. The bug has to
                happen here first, or the run stops.
              </dd>
            </div>
            <div>
              <dt>Sealed container</dt>
              <dd>
                A throwaway machine holding your code and nothing else — no internet, no
                DNS, no keys. It is destroyed when the run ends.
              </dd>
            </div>
            <div>
              <dt>Exit code</dt>
              <dd>
                The number a command leaves behind when it finishes. Zero means it passed.
                It is a fact, and it is what the score is built from.
              </dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>
                How far the proof actually got — reproduced, fixed, suite green. Stated
                plainly in the pull request, including when it is low.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="band close" aria-labelledby="close-h">
        <div>
          <h2 className="display-sm" id="close-h">
            Point it at one bug and read the evidence.
          </h2>
          <p className="lede">
            If it cannot prove the fix, you will know, because it will say so in the pull
            request — or open nothing at all.
          </p>
          <p className="calls">
            {signIn ? (
              <a className="top-call big" href="/auth/github">
                Continue with GitHub
              </a>
            ) : (
              <a className="top-call big" href={installUrl}>
                Install on GitHub
              </a>
            )}
          </p>
        </div>
      </section>
    </>
  );
}

/**
 * The footer, exported separately so `page.tsx` can render it OUTSIDE `<main>`.
 *
 * A `contentinfo` landmark nested inside `main` is either flagged by every audit tool or
 * dropped entirely, depending on which mapping the browser applies — so the site-wide
 * footer of the only public page was either an error or absent, and neither is what was
 * intended.
 */
export function LandingFooter() {
  return (
    <footer className="foot">
      <div>
        <p>Repro — an event-sourced execution and verification platform.</p>
        <p className="muted">Evidence over testimony. Reproduce first. Nothing merged.</p>
      </div>
    </footer>
  );
}
