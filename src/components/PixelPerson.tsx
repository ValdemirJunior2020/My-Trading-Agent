interface Props { status: string }
export function PixelPerson({ status }: Props) {
  return <div className={`pixel-person pixel-person--${status}`} aria-hidden="true">
    <span className="pixel-hair"/><span className="pixel-head"><i/><i/></span><span className="pixel-body"/><span className="pixel-arm left"/><span className="pixel-arm right"/><span className="pixel-leg left"/><span className="pixel-leg right"/>
  </div>
}
