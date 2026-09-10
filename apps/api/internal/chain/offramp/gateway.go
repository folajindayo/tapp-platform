package offramp

import (
	"fmt"
	"math/big"
	"strings"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// gatewayABI is the one function this package calls.
//
// Only createOrder. The wider Gateway ABI lives in services/evm, which binds
// it for a wallet the platform signs with; here the caller is the cardholder's
// smart account and CDP does the signing, so all that is needed is calldata.
const gatewayABI = `[
  {
    "type":"function","name":"createOrder","stateMutability":"nonpayable",
    "inputs":[
      {"name":"_token","type":"address"},
      {"name":"_amount","type":"uint256"},
      {"name":"_rate","type":"uint96"},
      {"name":"_senderFeeRecipient","type":"address"},
      {"name":"_senderFee","type":"uint256"},
      {"name":"_refundAddress","type":"address"},
      {"name":"messageHash","type":"string"}
    ],
    "outputs":[{"name":"orderId","type":"bytes32"}]
  }
]`

var parsedGateway = func() ethabi.ABI {
	a, err := ethabi.JSON(strings.NewReader(gatewayABI))
	if err != nil {
		panic("offramp: gateway ABI: " + err.Error())
	}
	return a
}()

type createOrderArgs struct {
	Token              common.Address
	Amount             *big.Int
	Rate               *big.Int
	SenderFeeRecipient common.Address
	SenderFee          *big.Int
	RefundAddress      common.Address
	MessageHash        string
}

func packCreateOrder(a createOrderArgs) (string, error) {
	data, err := parsedGateway.Pack("createOrder",
		a.Token, a.Amount, a.Rate, a.SenderFeeRecipient, a.SenderFee,
		a.RefundAddress, a.MessageHash)
	if err != nil {
		return "", fmt.Errorf("offramp: pack createOrder: %w", err)
	}
	return "0x" + common.Bytes2Hex(data), nil
}
