"""Synthetic AT-SPI tree: no desktop service or native input is imported."""
import json
import os


class Node:
    def __init__(self, name, children=()):
        self.name = name
        self.children = list(children)
        self.childCount = len(self.children)
        self.nActions = 1

    def getChildAtIndex(self, index):
        return self.children[index]

    def getRoleName(self):
        return "application"

    def queryAction(self):
        return self

    def getName(self, index):
        return "click"

    def doAction(self, index):
        with open(os.environ["CU_ATSPI_ACTIONS"], "a", encoding="utf-8") as output:
            output.write(json.dumps({"name": self.name, "action": "click"}) + "\n")


class Registry:
    @staticmethod
    def getDesktop(index):
        names = ["Fixture Extended", "Fixture"]
        if os.environ.get("CU_ATSPI_DUPLICATE") == "1":
            names.append("FIXTURE")
        return Node("desktop", [Node(name, [Node("child")]) for name in names])
