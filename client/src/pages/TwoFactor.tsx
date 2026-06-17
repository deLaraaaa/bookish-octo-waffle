import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, setToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LanguageSwitcher } from "@/components/language-switcher";

const RESEND_MS = 30_000; // cooldown de 30s entre reenvios

export default function TwoFactor() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const challenge = params.get("challenge") || "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (challenge) startCooldown();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCooldown() {
    const end = Date.now() + RESEND_MS;
    setRemaining(RESEND_MS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const left = end - Date.now();
      if (left <= 0) {
        setRemaining(0);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setRemaining(left);
      }
    }, 100);
  }

  const cooldownActive = remaining > 0;
  const progress = cooldownActive ? (1 - remaining / RESEND_MS) * 100 : 0;
  const secondsLeft = Math.ceil(remaining / 1000);

  async function submit(value: string) {
    setError(null);
    setLoading(true);
    try {
      const { token } = await api<{ token: string }>("/auth/2fa/verify", {
        method: "POST",
        body: { challenge, code: value },
      });
      setToken(token);
      const account = await refresh();
      navigate(account?.onboarding_completed ? "/" : "/onboarding", {
        replace: true,
      });
    } catch (e) {
      const key = e instanceof Error ? e.message : "";
      setError(t([`twoFactor.errors.${key}`, "twoFactor.verifyError"]));
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (cooldownActive) return;
    setError(null);
    setResent(false);
    try {
      await api("/auth/2fa/resend", { method: "POST", body: { challenge } });
      setResent(true);
      startCooldown();
    } catch {
      setError(t("twoFactor.resendError"));
    }
  }

  if (!challenge) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <p>{t("twoFactor.invalidLink")}</p>
        <Button variant="link" asChild>
          <Link to="/login">{t("common.backToLogin")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-muted/40 p-4">
      <LanguageSwitcher className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          style={{ margin: "5px 0 0 5px" }}
          asChild
        >
          <Link to="/login">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("common.backToLogin")}
          </Link>
        </Button>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t("twoFactor.title")}</CardTitle>
          <CardDescription>{t("twoFactor.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <InputOTP
            maxLength={4}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (v.length === 4) submit(v);
            }}
            disabled={loading}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {resent && (
            <p className="text-sm text-muted-foreground">
              {t("twoFactor.codeResent")}
            </p>
          )}

          <Button
            variant="outline"
            className="w-full"
            disabled={code.length !== 4 || loading}
            onClick={() => submit(code)}
          >
            {loading ? t("twoFactor.verifying") : t("twoFactor.verify")}
          </Button>

          {cooldownActive ? (
            <div className="flex w-full flex-col items-center gap-2">
              <Progress value={progress} className="h-1 w-2/3" />
              <span className="text-xs text-muted-foreground">
                {t("twoFactor.resendIn", { seconds: secondsLeft })}
              </span>
            </div>
          ) : (
            <Button
              variant="link"
              className="text-xs"
              onClick={resend}
              disabled={loading}
            >
              {t("twoFactor.resend")}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
