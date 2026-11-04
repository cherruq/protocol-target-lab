"""DNS wire regressions; no sockets or product response mocks are needed."""
import struct
import unittest

from dns_wire import decode, encode_name, read_name


class DnsNameTests(unittest.TestCase):
    def test_maximum_label_count_with_compressed_answer(self):
        name = ".".join(["a"] * 127)
        self.assertEqual(len(name), 253)
        question = encode_name(name) + struct.pack("!HH", 1, 1)
        answer = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + bytes([192, 0, 2, 28])
        message = struct.pack("!6H", 1234, 0x8180, 1, 1, 0, 0) + question + answer
        response = decode(message)
        self.assertEqual(response["question"]["name"], name)
        self.assertEqual(response["answers"][0]["name"], name)
        self.assertEqual(response["answers"][0]["value"], "192.0.2.28")

    def test_compression_cycles_are_rejected(self):
        for message in (b"\xc0\x00", b"\xc0\x02\xc0\x00"):
            with self.subTest(message=message), self.assertRaises(ValueError):
                read_name(message, 0)

    def test_excessive_pointer_chain_remains_bounded(self):
        # A malformed chain must not turn the increased name budget into unbounded work.
        message = b"".join(struct.pack("!H", 0xc000 | (i + 1) * 2) for i in range(257)) + b"\0"
        with self.assertRaises(ValueError):
            read_name(message, 0)


if __name__ == "__main__":
    unittest.main()
