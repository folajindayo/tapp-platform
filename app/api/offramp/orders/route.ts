import { jsonError, railsSenderPost } from "@/lib/offramp/rails";

export const dynamic = "force-dynamic";

interface CreateOfframpOrderBody {
  amount?: string;
  token?: "SUI" | "USDC" | "USDT";
  network?: string;
  rate?: string;
  rateId?: string;
  reference?: string;
  recipient?: {
    institution?: string;
    currency?: string;
    accountIdentifier?: string;
    accountName?: string;
    account_identifier?: string;
    account_name?: string;
    memo?: string;
  };
}

export interface OfframpDepositOption {
  method: "ptb" | "receive_address" | string;
  label: string;
  gateway_package_id?: string;
  ptb_base64?: string;
  address?: string;
  qr_payload?: string;
}

export interface OfframpOrder {
  order_id: string;
  status: string;
  rate_quoted: string;
  fiat_amount: string;
  fee: string;
  id?: string;
  amount?: string;
  rate?: string;
  coin_type?: string;
  receive_address?: string;
  valid_until?: string;
  pay_to?: {
    chain: string;
    amount: string;
    coin_type: string;
    options: OfframpDepositOption[];
  };
}

export async function POST(req: Request): Promise<Response> {
  let body: CreateOfframpOrderBody;
  try {
    body = (await req.json()) as CreateOfframpOrderBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const amount = body.amount?.trim();
  const recipient = body.recipient;
  const accountIdentifier =
    recipient?.accountIdentifier?.trim() || recipient?.account_identifier?.trim();
  const accountName =
    recipient?.accountName?.trim() || recipient?.account_name?.trim();
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return Response.json({ error: "amount must be greater than zero" }, { status: 400 });
  }
  if (!body.rate && !body.rateId) {
    return Response.json({ error: "rate or rateId is required" }, { status: 400 });
  }
  if (
    !recipient?.institution ||
    !recipient.currency ||
    !accountIdentifier ||
    !accountName
  ) {
    return Response.json({ error: "recipient bank details are incomplete" }, { status: 400 });
  }

  const network =
    body.network ??
    (process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet" ? "sui-mainnet" : "sui-testnet");

  try {
    const reference =
      body.reference?.trim() || `TAPP-${Date.now().toString(36).toUpperCase()}`;
    const memo = recipient.memo?.trim() || reference;
    const data = await railsSenderPost<OfframpOrder>("/v1/sender/orders/route-a", {
      amount,
      token: "USDC",
      network,
      rateId: body.rateId,
      rate: body.rate,
      reference,
      recipient: {
        institution: recipient.institution,
        currency: recipient.currency,
        accountIdentifier,
        accountName,
        account_identifier: accountIdentifier,
        account_name: accountName,
        memo,
      },
    });
    return Response.json({ data: normalizeOrder(data) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

function normalizeOrder(order: OfframpOrder): OfframpOrder {
  if (order.pay_to) return order;
  const receiveAddress = order.receive_address;
  return {
    ...order,
    order_id: order.order_id ?? order.id ?? "",
    status: order.status ?? "awaiting_deposit",
    rate_quoted: order.rate_quoted ?? order.rate ?? "",
    fiat_amount: order.fiat_amount ?? "",
    fee: order.fee ?? "0",
    pay_to: receiveAddress
      ? {
          chain: "sui",
          amount: order.amount ?? "",
          coin_type: order.coin_type ?? "",
          options: [
            {
              method: "receive_address",
              label: "Send from your Tapp wallet",
              address: receiveAddress,
              qr_payload: `sui:${receiveAddress}?amount=${encodeURIComponent(order.amount ?? "")}`,
            },
          ],
        }
      : undefined,
  };
}
