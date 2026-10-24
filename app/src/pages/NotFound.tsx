import { Link } from "react-router-dom";
import { buttonClass, Card } from "../components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-bold">Lost the beat</h1>
      <p className="text-muted">We couldn't find that page.</p>
      <Link to="/" className={buttonClass("primary")}>
        Go home
      </Link>
    </Card>
  );
}
