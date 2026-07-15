import { GlobalRegistrator } from "@happy-dom/global-registrator";

process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = "http://127.0.0.1:4317";

GlobalRegistrator.register({ url: "http://127.0.0.1:3000/" });
