export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-6 py-20 dark:bg-black sm:py-28">
      {children}
    </main>
  );
}
