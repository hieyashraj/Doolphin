import Link from "next/link";
import "./landing.css";

const videos = [
  { src: "/explore/Explore 01.mp4", poster: "/avatars/Shyla E1.png", title: "Skincare unboxing", label: "UGC" },
  { src: "/explore/Explore 02.mp4", poster: "/avatars/Andrew E1.png", title: "Creator reaction", label: "Creator" },
  { src: "/explore/Explore 03.mp4", poster: "/avatars/Matty E1.png", title: "Beverage campaign", label: "Product" },
  { src: "/explore/Explore 05.mp4", poster: "/avatars/Hannah E1.png", title: "Haircare routine", label: "Beauty" },
  { src: "/explore/Explore 06.mp4", poster: "/avatars/Jim E1.png", title: "Coffee launch", label: "Product" },
  { src: "/explore/Explore 07.mp4", poster: "/avatars/Naomi E1.png", title: "Fashion editorial", label: "Fashion" },
  { src: "/explore/Explore 08.mp4", poster: "/avatars/Elizabeth E1.png", title: "Luxury fragrance", label: "Luxury" },
  { src: "/explore/Explore 09.mp4", poster: "/avatars/Josh E1.png", title: "Founder story", label: "UGC" },
];

const pathways = [
  { number: "01", eyebrow: "UGC video", title: "A creator for every crazy idea.", body: "Turn a thought and a face into the kind of direct-to-camera creative that belongs in the feed.", video: videos[0] },
  { number: "02", eyebrow: "Product ads", title: "Make the product the main character.", body: "Take a product image from still life to a campaign moment with movement, mood, and attention built in.", video: videos[2] },
  { number: "03", eyebrow: "App walkthroughs", title: "Show the feeling, not just the features.", body: "Build launch films and social moments that make a product feel alive before anyone taps download.", video: videos[1] },
  { number: "04", eyebrow: "AI avatars", title: "A cast that never runs out of takes.", body: "Choose a face, a voice, and a point of view—then keep the best version of the idea moving.", video: videos[7] },
];

function VideoCard({ video, className = "", priority = false }) {
  return <figure className={`media-card ${className}`}>
    <video autoPlay muted loop playsInline preload={priority ? "auto" : "metadata"} poster={video.poster} aria-label={video.title}>
      <source src={video.src} type="video/mp4" />
    </video>
    <figcaption><span>{video.label}</span><span>{video.title}</span></figcaption>
  </figure>;
}

export default function HomePage() {
  return <main className="landing-page">
    <nav className="landing-nav" aria-label="Primary navigation">
      <Link className="wordmark" href="/" aria-label="Doolphin home"><span className="wordmark-mark">d</span>Doolphin</Link>
      <div className="nav-links"><Link href="/pricing">Pricing</Link><Link href="/sign-in">Log in</Link><Link className="signup-button" href="/sign-up">Sign up <span aria-hidden="true">↗</span></Link></div>
    </nav>

    <section className="hero-section" aria-labelledby="hero-title">
      <p className="eyebrow">Doolphin AI studio <span>✦</span> Make it move</p>
      <h1 id="hero-title">AI Video Generator.<br /><em>Studio-Grade Quality.</em></h1>
      <p className="hero-copy">From prompt to high quality video in seconds. World-class AI Models and Avatars. Bring crazy ideas to life.</p>
      <Link className="signup-button hero-button" href="/sign-up">Sign up <span aria-hidden="true">↗</span></Link>
      <div className="hero-collage" aria-label="A selection of Doolphin-generated videos">
        <VideoCard video={videos[5]} className="hero-video hero-video-left" />
        <VideoCard video={videos[0]} className="hero-video hero-video-main" priority />
        <VideoCard video={videos[6]} className="hero-video hero-video-right" />
        <p className="collage-note">Scroll-stopping<br />starts here <span>↘</span></p>
      </div>
    </section>

    <section className="ribbon-section" aria-label="Creative possibilities">
      <div className="ribbon-track"><span>UGC video</span><i>✦</i><span>Product ads</span><i>✦</i><span>App walkthroughs</span><i>✦</i><span>Image-to-video</span><i>✦</i><span>AI avatars</span><i>✦</i><span>UGC video</span><i>✦</i><span>Product ads</span></div>
    </section>

    <section className="intro-section" aria-labelledby="made-to-move">
      <p className="eyebrow">The new creative reflex</p>
      <div><h2 id="made-to-move">Made to <em>move.</em></h2><p>Most ideas die before production. Doolphin gives them a camera, a cast, and a reason to be watched.</p></div>
    </section>

    <section className="output-grid" aria-label="Doolphin output gallery">
      <VideoCard video={videos[3]} className="grid-tall" />
      <VideoCard video={videos[4]} className="grid-wide" />
      <article className="gallery-copy"><p className="eyebrow">Your creative, unblocked</p><h3>One idea.<br /><em>Infinite takes.</em></h3><Link href="/sign-up">Start making <span>↗</span></Link></article>
      <VideoCard video={videos[1]} className="grid-square" />
      <VideoCard video={videos[7]} className="grid-square" />
      <VideoCard video={videos[6]} className="grid-wide grid-luxury" />
    </section>

    <section className="pathways-section" aria-labelledby="pathways-title">
      <header><p className="eyebrow">Choose a starting point</p><h2 id="pathways-title">However you see it,<br /><em>make it real.</em></h2></header>
      <div className="pathway-list">{pathways.map((pathway) => <article className="pathway" key={pathway.number}>
        <div className="pathway-number">{pathway.number}</div>
        <div className="pathway-copy"><p className="eyebrow">{pathway.eyebrow}</p><h3>{pathway.title}</h3><p>{pathway.body}</p><Link href="/sign-up">Sign up <span>↗</span></Link></div>
        <VideoCard video={pathway.video} className="pathway-video" />
      </article>)}</div>
    </section>

    <section className="prompt-section" aria-labelledby="prompt-title">
      <div className="prompt-heading"><p className="eyebrow">A little input. A lot of output.</p><h2 id="prompt-title">The shortest distance<br />between <em>idea and action.</em></h2></div>
      <div className="prompt-flow">
        <article className="flow-card prompt-card"><span className="flow-label">01 / Prompt</span><p>“A creator unboxes a fresh skincare discovery in soft morning light. It feels honest, spontaneous, and impossible to skip.”</p></article>
        <div className="flow-arrow" aria-hidden="true">→</div>
        <article className="flow-card reference-card"><span className="flow-label">02 / Reference</span><img src="/avatars/Shyla E1.png" alt="Example AI creator reference" /></article>
        <div className="flow-arrow" aria-hidden="true">→</div>
        <VideoCard video={videos[0]} className="flow-result" />
      </div>
    </section>

    <section className="models-section" aria-labelledby="models-title">
      <div className="models-media"><img src="/avatars/Andrew E1.png" alt="Doolphin AI avatar" /><img src="/avatars/Elizabeth E1.png" alt="Doolphin AI avatar" /><img src="/avatars/Naomi E1.png" alt="Doolphin AI avatar" /></div>
      <div className="models-copy"><p className="eyebrow">Models, but make them magic</p><h2 id="models-title">A world-class<br /><em>creative bench.</em></h2><p>From photoreal character performances to polished product worlds, Doolphin lets the best AI video models do their best work.</p><div className="model-chips"><span>Veo</span><span>Seedance</span><span>Grok</span><span>Kling</span><span>+ more</span></div></div>
    </section>

    <section className="vibes-section" aria-labelledby="vibes-title">
      <header><p className="eyebrow">Pick a vibe</p><h2 id="vibes-title">The brief says everything.<br /><em>The vibe says the rest.</em></h2></header>
      <div className="vibes-rail">{videos.map((video) => <VideoCard video={video} className="vibe-card" key={video.src} />)}</div>
    </section>

    <section className="conversion-section"><p className="eyebrow">Go on, make the thing</p><h2>Your next idea<br />deserves a <em>camera crew.</em></h2><Link className="signup-button" href="/sign-up">Sign up <span aria-hidden="true">↗</span></Link></section>

    <section className="closing-mosaic" aria-label="Final Doolphin video showcase"><VideoCard video={videos[2]} /><VideoCard video={videos[4]} /><VideoCard video={videos[5]} /><VideoCard video={videos[7]} /><div><p className="eyebrow">Doolphin</p><h2>Make it<br /><em>unmissable.</em></h2></div></section>

    <footer className="landing-footer">
      <div><Link className="wordmark" href="/"><span className="wordmark-mark">d</span>Doolphin</Link><p>AI video for ideas that deserve to move.</p></div>
      <div className="footer-links"><div><p>Explore</p><Link href="/pricing">Pricing</Link><span aria-label="Coming soon">AI <small>Coming soon</small></span></div><div><p>Company</p><span aria-label="Coming soon">About <small>Coming soon</small></span><span aria-label="Coming soon">Contact <small>Coming soon</small></span></div><div><p>Legal</p><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div></div>
      <p className="footer-bottom">© {new Date().getFullYear()} Doolphin. Made for big ideas.</p>
    </footer>
  </main>;
}
