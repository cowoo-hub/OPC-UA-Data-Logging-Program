import { FaLinkedin } from 'react-icons/fa'

export default function Footer() {
  return (
    <footer className="rail-footer app-footer" aria-label="Developer footer">
      <a
        href="https://www.linkedin.com/in/hyein-woo-615a0a20b/?locale=en"
        target="_blank"
        rel="noopener noreferrer"
        className="app-footer__linkedin"
        aria-label="Open developer LinkedIn profile"
      >
        <FaLinkedin />
      </a>

      <span className="app-footer__text">Developed by Hye In, Woo (Wayne)</span>
    </footer>
  )
}
