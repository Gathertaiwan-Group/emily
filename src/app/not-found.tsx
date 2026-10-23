import { SearchForm } from "@/components/Shell";

export const metadata = { title: { absolute: "Page Not Found - The three of us" }, robots: "follow, noindex" };

export default function NotFound() {
  return (
    <div className="container page-404">
      <div className="error-404">
        <div className="error-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wp/wp-content/themes/soledad/images/404.png" alt="404" width={212} height={87} />
        </div>
        <p className="sub-heading-text-404">OOPS! Page you&apos;re looking for doesn&apos;t exist. Please use search for help</p>
        <SearchForm />
        <p className="go-back-home">
          <a href="/">Back to Home Page</a>
        </p>
      </div>
    </div>
  );
}
